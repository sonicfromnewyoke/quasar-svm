use criterion::{black_box, criterion_group, criterion_main, Criterion};
use quasar_svm::token::{create_keyed_associated_token_account, create_keyed_mint_account, Mint};
use quasar_svm::{Account, AccountMeta, Instruction, Pubkey, QuasarSvm, QuasarSvmConfig, SPL_TOKEN_PROGRAM_ID};

// ---------------------------------------------------------------------------
// Counting allocator — tracks alloc/dealloc counts and total bytes allocated.
// Relaxed ordering is sufficient: benchmarks are single-threaded, and we only
// need approximate deltas between snapshots, not cross-thread consistency.
// ---------------------------------------------------------------------------

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};

static ALLOC_COUNT: AtomicU64 = AtomicU64::new(0);
static DEALLOC_COUNT: AtomicU64 = AtomicU64::new(0);
static ALLOC_BYTES: AtomicU64 = AtomicU64::new(0);

struct CountingAllocator;

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOC_COUNT.fetch_add(1, Relaxed);
        ALLOC_BYTES.fetch_add(layout.size() as u64, Relaxed);
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        DEALLOC_COUNT.fetch_add(1, Relaxed);
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static GLOBAL: CountingAllocator = CountingAllocator;

struct AllocSnapshot {
    allocs: u64,
    deallocs: u64,
    bytes: u64,
}

fn alloc_snapshot() -> AllocSnapshot {
    AllocSnapshot {
        allocs: ALLOC_COUNT.load(Relaxed),
        deallocs: DEALLOC_COUNT.load(Relaxed),
        bytes: ALLOC_BYTES.load(Relaxed),
    }
}

fn print_alloc_stats(label: &str, before: &AllocSnapshot, after: &AllocSnapshot, iterations: u64) {
    let allocs = after.allocs - before.allocs;
    let deallocs = after.deallocs - before.deallocs;
    let bytes = after.bytes - before.bytes;
    eprintln!(
        "  [{label}] {iterations} iterations: {allocs} allocs, {deallocs} deallocs, {} bytes ({} allocs/iter, {} bytes/iter)",
        bytes,
        allocs / iterations,
        bytes / iterations,
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_system_transfer_ix(from: &Pubkey, to: &Pubkey, lamports: u64) -> Instruction {
    let mut data = vec![2, 0, 0, 0];
    data.extend_from_slice(&lamports.to_le_bytes());
    Instruction {
        program_id: quasar_svm::system_program::ID,
        accounts: vec![
            AccountMeta::new(*from, true),
            AccountMeta::new(*to, false),
        ],
        data,
    }
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

fn bench_svm_new(c: &mut Criterion) {
    c.bench_function("svm_new_default", |b| {
        b.iter(|| black_box(QuasarSvm::new()));
    });

    c.bench_function("svm_new_bare", |b| {
        b.iter(|| {
            black_box(QuasarSvm::new_with_config(QuasarSvmConfig {
                token: false,
                token_2022: false,
                associated_token: false,
            }))
        });
    });
}

fn bench_system_transfer(c: &mut Criterion) {
    let mut svm = QuasarSvm::new_with_config(QuasarSvmConfig {
        token: false,
        token_2022: false,
        associated_token: false,
    });

    let sender = Pubkey::new_unique();
    let recipient = Pubkey::new_unique();

    svm.airdrop(&sender, 1_000_000_000_000);
    svm.create_account(&recipient, 0, &quasar_svm::system_program::ID);

    let ix = make_system_transfer_ix(&sender, &recipient, 1_000);

    let sender_account = Account {
        address: sender,
        owner: quasar_svm::system_program::ID,
        lamports: 1_000_000_000_000,
        data: vec![],
        executable: false,
    };
    let recipient_account = Account {
        address: recipient,
        owner: quasar_svm::system_program::ID,
        lamports: 0,
        data: vec![],
        executable: false,
    };

    // Allocation profiling pass — runs before criterion to print allocs/iter stats.
    // This also warms up the SVM (commits accounts to the store), matching steady-state.
    let n = 1000;
    let before = alloc_snapshot();
    for _ in 0..n {
        let result = svm.process_instruction(&ix, &[sender_account.clone(), recipient_account.clone()]);
        black_box(&result);
    }
    let after = alloc_snapshot();
    print_alloc_stats("system_transfer", &before, &after, n);

    c.bench_function("system_transfer", |b| {
        b.iter(|| {
            let result =
                svm.process_instruction(black_box(&ix), &[sender_account.clone(), recipient_account.clone()]);
            black_box(&result);
        });
    });
}

fn bench_spl_token_transfer(c: &mut Criterion) {
    let mut svm = QuasarSvm::new().with_token_program();

    let authority = Pubkey::new_unique();
    let mint_addr = Pubkey::new_unique();

    let authority_account = Account {
        address: authority,
        owner: quasar_svm::system_program::ID,
        lamports: 1_000_000_000,
        data: vec![],
        executable: false,
    };

    let mint = create_keyed_mint_account(
        &mint_addr,
        &Mint {
            decimals: 6,
            supply: 1_000_000,
            ..Default::default()
        },
    );

    let alice = create_keyed_associated_token_account(&authority, &mint_addr, 500_000);
    let bob = create_keyed_associated_token_account(&authority, &mint_addr, 0);

    let transfer_ix = spl_token::instruction::transfer(
        &SPL_TOKEN_PROGRAM_ID,
        &alice.address,
        &bob.address,
        &authority,
        &[],
        100,
    )
    .unwrap();

    // Allocation profiling pass — runs before criterion to print allocs/iter stats.
    // This also warms up the SVM (commits accounts to the store), matching steady-state.
    let n = 1000;
    let before = alloc_snapshot();
    for _ in 0..n {
        let result = svm.process_instruction(
            &transfer_ix,
            &[authority_account.clone(), mint.clone(), alice.clone(), bob.clone()],
        );
        black_box(&result);
    }
    let after = alloc_snapshot();
    print_alloc_stats("spl_token_transfer", &before, &after, n);

    c.bench_function("spl_token_transfer", |b| {
        b.iter(|| {
            let result = svm.process_instruction(
                black_box(&transfer_ix),
                &[
                    authority_account.clone(),
                    mint.clone(),
                    alice.clone(),
                    bob.clone(),
                ],
            );
            black_box(&result);
        });
    });
}

fn bench_simulate(c: &mut Criterion) {
    let mut svm = QuasarSvm::new_with_config(QuasarSvmConfig {
        token: false,
        token_2022: false,
        associated_token: false,
    });

    let sender = Pubkey::new_unique();
    let recipient = Pubkey::new_unique();
    svm.airdrop(&sender, 1_000_000_000_000);

    let ix = make_system_transfer_ix(&sender, &recipient, 1_000);

    let sender_account = Account {
        address: sender,
        owner: quasar_svm::system_program::ID,
        lamports: 1_000_000_000_000,
        data: vec![],
        executable: false,
    };
    let recipient_account = Account {
        address: recipient,
        owner: quasar_svm::system_program::ID,
        lamports: 0,
        data: vec![],
        executable: false,
    };

    // Allocation profiling pass — runs before criterion to print allocs/iter stats.
    // This also warms up the SVM (commits accounts to the store), matching steady-state.
    let n = 1000;
    let before = alloc_snapshot();
    for _ in 0..n {
        let result = svm.simulate_instruction(&ix, &[sender_account.clone(), recipient_account.clone()]);
        black_box(&result);
    }
    let after = alloc_snapshot();
    print_alloc_stats("simulate_system_transfer", &before, &after, n);

    c.bench_function("simulate_system_transfer", |b| {
        b.iter(|| {
            let result = svm.simulate_instruction(
                black_box(&ix),
                &[sender_account.clone(), recipient_account.clone()],
            );
            black_box(&result);
        });
    });
}

criterion_group!(
    benches,
    bench_svm_new,
    bench_system_transfer,
    bench_spl_token_transfer,
    bench_simulate,
);
criterion_main!(benches);
