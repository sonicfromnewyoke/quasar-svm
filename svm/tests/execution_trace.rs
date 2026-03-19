/// Test execution trace for debugging and error analysis
use quasar_svm::token::{create_keyed_mint_account, Mint};
use quasar_svm::{QuasarSvm, Account, Pubkey, SPL_TOKEN_PROGRAM_ID};

#[test]
fn test_execution_trace_simple_transfer() {
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

    let alice = quasar_svm::token::create_keyed_associated_token_account(
        &authority,
        &mint_addr,
        500_000,
    );
    let bob = quasar_svm::token::create_keyed_associated_token_account(
        &authority,
        &mint_addr,
        0,
    );

    let transfer_ix = spl_token::instruction::transfer(
        &SPL_TOKEN_PROGRAM_ID,
        &alice.address,
        &bob.address,
        &authority,
        &[],
        100,
    ).unwrap();

    println!("\n🧪 Testing Execution Trace (Simple Transfer)\n");

    let result = svm.process_instruction(
        &transfer_ix,
        &[authority_account, mint, alice, bob],
    );

    println!("📊 Execution Result:");
    println!("  Success: {}", result.is_ok());
    println!("  Compute units: {}", result.compute_units_consumed);

    // Show execution trace
    println!("\n📊 Execution Trace:");
    println!("  Total executed instructions: {}", result.execution_trace.instructions.len());
    for (idx, instr) in result.execution_trace.instructions.iter().enumerate() {
        let indent = "  ".repeat(instr.nesting_level as usize);
        let status = if instr.succeeded { "✓" } else { "✗" };
        println!("  [{}] {}L{} {status} → {}",
            idx,
            indent,
            instr.nesting_level,
            instr.program_id
        );
    }

    println!("\n📈 Analysis:");
    println!("  Total instructions: {}", result.execution_trace.instructions.len());
    let top_level: Vec<_> = result.execution_trace.instructions.iter().filter(|i| i.nesting_level == 0).collect();
    let cpis: Vec<_> = result.execution_trace.instructions.iter().filter(|i| i.nesting_level == 1).collect();
    println!("  Top-level only: {}", top_level.len());
    println!("  CPIs: {}", cpis.len());
    println!("  → This is a direct instruction with no CPIs");

    assert!(result.is_ok());
}

#[test]
fn test_execution_trace_on_error() {
    let mut svm = QuasarSvm::new().with_token_program();

    let authority = Pubkey::new_unique();
    let wrong_authority = Pubkey::new_unique();
    let mint_addr = Pubkey::new_unique();

    // Create wrong authority account
    let wrong_authority_account = Account {
        address: wrong_authority,
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

    let alice = quasar_svm::token::create_keyed_associated_token_account(
        &authority,  // Owned by correct authority
        &mint_addr,
        500_000,
    );
    let bob = quasar_svm::token::create_keyed_associated_token_account(
        &authority,
        &mint_addr,
        0,
    );

    // Try to transfer with WRONG authority (should fail)
    let transfer_ix = spl_token::instruction::transfer(
        &SPL_TOKEN_PROGRAM_ID,
        &alice.address,
        &bob.address,
        &wrong_authority,  // Wrong signer!
        &[],
        100,
    ).unwrap();

    println!("\n🧪 Testing Execution Trace on Error\n");
    println!("Attempting transfer with wrong authority (should fail)...");

    let result = svm.process_instruction(
        &transfer_ix,
        &[wrong_authority_account, mint, alice, bob],
    );

    println!("\n📊 Execution Result:");
    println!("  Success: {}", result.is_ok());
    println!("  Error: {:?}", result.raw_result);

    // Show execution trace
    println!("\n📊 Execution Trace:");
    if result.execution_trace.instructions.is_empty() {
        println!("  No execution trace available");
    } else {
        println!("  Total executed instructions: {}", result.execution_trace.instructions.len());
        for (idx, instr) in result.execution_trace.instructions.iter().enumerate() {
            let indent = "  ".repeat(instr.nesting_level as usize);
            let status = if instr.succeeded { "✓" } else { "✗" };
            println!("  [{}] {}L{} {status} → {}",
                idx,
                indent,
                instr.nesting_level,
                instr.program_id
            );
        }

        if result.is_err() {
            if let Some(failure) = result.execution_trace.instructions.last() {
                println!("\n❌ Execution halted at:");
                println!("  Program: {}", failure.program_id);
                println!("  Nesting level: {}", failure.nesting_level);
            }
        }
    }

    // Show error debugging information
    if result.is_err() {
        println!("\n🔍 Error Debugging Information:");

        if let Some(failure_instr) = result.execution_trace.instructions.last() {
            println!("  Nesting level: {} (depth in CPI stack)", failure_instr.nesting_level);
            println!("  Program that failed: {}", failure_instr.program_id);
            println!("  Succeeded: {}", failure_instr.succeeded);
        }

        let call_stack: Vec<_> = result.execution_trace.instructions.iter().collect();
        println!("\n  Full call stack ({} instructions):", call_stack.len());
        for (idx, instr) in call_stack.iter().enumerate() {
            let indent = "    ".repeat(instr.nesting_level as usize);
            let status = if instr.succeeded { "✓" } else { "✗" };
            println!("    {}[{}] L{} {status} {}",
                indent,
                idx,
                instr.nesting_level,
                instr.program_id
            );
        }
    }

    println!("\n📝 Transaction Logs:");
    for log in &result.logs {
        println!("  {}", log);
    }

    assert!(result.is_err(), "Transfer should fail with wrong authority");
}
