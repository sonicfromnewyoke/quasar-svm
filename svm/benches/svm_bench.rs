use criterion::{black_box, criterion_group, criterion_main, Criterion};
use quasar_svm::token::{create_keyed_associated_token_account, create_keyed_mint_account, Mint};
use quasar_svm::{
    Account, AccountMeta, Instruction, Pubkey, QuasarSvm, QuasarSvmConfig, SPL_TOKEN_PROGRAM_ID,
};

fn make_system_transfer_ix(from: &Pubkey, to: &Pubkey, lamports: u64) -> Instruction {
    let mut data = vec![2, 0, 0, 0];
    data.extend_from_slice(&lamports.to_le_bytes());
    Instruction {
        program_id: quasar_svm::system_program::ID,
        accounts: vec![AccountMeta::new(*from, true), AccountMeta::new(*to, false)],
        data,
    }
}

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

    c.bench_function("system_transfer", |b| {
        b.iter(|| {
            let result = svm.process_instruction(
                black_box(&ix),
                &[sender_account.clone(), recipient_account.clone()],
            );
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
