/// Test inner instruction (CPI) capture

use quasar_svm::token::{create_keyed_mint_account, create_keyed_associated_token_account, Mint};
use quasar_svm::{QuasarSvm, Account, Pubkey, SPL_TOKEN_PROGRAM_ID};

#[test]
fn test_inner_instruction_capture() {
    let mut svm = QuasarSvm::new();

    // Setup accounts
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

    // Create transfer instruction
    let transfer_ix = spl_token::instruction::transfer(
        &SPL_TOKEN_PROGRAM_ID,
        &alice.address,
        &bob.address,
        &authority,
        &[],
        100,
    ).unwrap();

    println!("\n🧪 Testing Inner Instruction Capture\n");
    println!("Executing SPL Token Transfer...");

    // Execute
    let result = svm.process_instruction(
        &transfer_ix,
        &[authority_account, mint, alice, bob],
    );

    println!("\n📊 Execution Result:");
    println!("  Success: {}", result.is_ok());
    println!("  Compute units: {}", result.compute_units_consumed);
    println!("  Logs: {}", result.logs.len());

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

    if result.raw_result.is_err() {
        println!("\n❌ Execution halted at:");
        if let Some(last) = result.execution_trace.instructions.last() {
            println!("  Program: {}", last.program_id);
            println!("  Nesting level: {} (depth in CPI stack)", last.nesting_level);

            // Show call stack by filtering instructions with nesting <= current
            println!("\n  Call stack (parent callers):");
            let mut stack_instructions: Vec<_> = result.execution_trace.instructions.iter()
                .filter(|i| i.nesting_level <= last.nesting_level)
                .collect();
            stack_instructions.reverse();
            for instr in stack_instructions.iter().take(5) {
                println!("    L{} → {}", instr.nesting_level, instr.program_id);
            }
        }
    }

    // Legacy inner instructions (for backwards compatibility)
    println!("\n🔍 Legacy Inner Instructions (grouped by top-level):");
    println!("  Count: {}", result.inner_instructions.len());
    if result.inner_instructions.is_empty() {
        println!("  → No CPIs detected (direct instruction execution)");
    } else {
        for inner_set in &result.inner_instructions {
            println!("\n  Top-level instruction #{} had {} CPI(s):", inner_set.index, inner_set.instructions.len());
            for (i, ix) in inner_set.instructions.iter().enumerate() {
                println!("    [{}] Program ID index: {}", i, ix.program_id_index);
                println!("        Accounts: {:?}", ix.accounts);
                println!("        Data length: {} bytes", ix.data.len());
            }
        }
    }

    // Debug: Show raw structure
    println!("\n🔧 Raw Structure:");
    println!("  inner_instructions: {:?}", result.inner_instructions);

    println!("\n📝 Transaction Logs:");
    for log in &result.logs {
        println!("  {}", log);
    }

    assert!(result.is_ok(), "Transfer should succeed");
}
