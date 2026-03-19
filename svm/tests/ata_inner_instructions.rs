/// Test to show inner instructions with actual CPIs (ATA creation)
use quasar_svm::token::{create_keyed_mint_account, Mint};
use quasar_svm::{QuasarSvm, Account, Pubkey, SPL_TOKEN_PROGRAM_ID, SPL_ASSOCIATED_TOKEN_PROGRAM_ID};
use solana_instruction::Instruction;

#[test]
fn test_ata_creation_with_cpis() {
    let mut svm = QuasarSvm::new()
        .with_token_program()
        .with_associated_token_program();

    // Setup accounts
    let payer = Pubkey::new_unique();
    let wallet = Pubkey::new_unique();
    let mint_addr = Pubkey::new_unique();

    let payer_account = Account {
        address: payer,
        owner: quasar_svm::system_program::ID,
        lamports: 10_000_000_000,
        data: vec![],
        executable: false,
    };

    let wallet_account = Account {
        address: wallet,
        owner: quasar_svm::system_program::ID,
        lamports: 0,
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

    // Manually derive ATA address using PDA
    let (ata_address, _bump) = Pubkey::find_program_address(
        &[
            wallet.as_ref(),
            SPL_TOKEN_PROGRAM_ID.as_ref(),
            mint_addr.as_ref(),
        ],
        &SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    println!("\n🧪 Testing ATA Creation (with CPIs)\n");
    println!("Payer: {}", payer);
    println!("Wallet: {}", wallet);
    println!("Mint: {}", mint_addr);
    println!("Expected ATA: {}\n", ata_address);

    // Create the ATA instruction
    let create_ata_ix = Instruction {
        program_id: SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts: vec![
            solana_instruction::AccountMeta::new(payer, true),              // fee payer
            solana_instruction::AccountMeta::new(ata_address, false),       // associated token account
            solana_instruction::AccountMeta::new_readonly(wallet, false),   // wallet
            solana_instruction::AccountMeta::new_readonly(mint_addr, false),// mint
            solana_instruction::AccountMeta::new_readonly(quasar_svm::system_program::ID, false), // system program
            solana_instruction::AccountMeta::new_readonly(SPL_TOKEN_PROGRAM_ID, false), // token program
        ],
        data: vec![], // ATA program takes no instruction data for create
    };

    // Execute
    let result = svm.process_instruction(
        &create_ata_ix,
        &[payer_account, wallet_account, mint],
    );

    println!("📊 Execution Result:");
    println!("  Success: {}", result.is_ok());
    println!("  Compute units: {}", result.compute_units_consumed);
    println!("  Logs: {}\n", result.logs.len());

    // Show execution trace
    println!("📊 Execution Trace:");
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

    // Show inner instructions (the main point of this test)
    println!("\n🔍 Legacy Inner Instructions (grouped by top-level):");
    println!("  Count: {}", result.inner_instructions.len());

    if result.inner_instructions.is_empty() {
        println!("  → No CPIs detected");
    } else {
        for inner_set in &result.inner_instructions {
            println!("\n  ✓ Top-level instruction #{} had {} CPI(s):", inner_set.index, inner_set.instructions.len());
            for (i, ix) in inner_set.instructions.iter().enumerate() {
                println!("    [{i}] Program ID index: {}", ix.program_id_index);
                println!("        Accounts: {:?}", ix.accounts);
                println!("        Data length: {} bytes", ix.data.len());
                if !ix.data.is_empty() {
                    println!("        Data (first 32 bytes): {:?}", &ix.data[..ix.data.len().min(32)]);
                }
            }
        }
    }

    // Debug: Show raw structure
    println!("\n🔧 Raw Structure:");
    println!("  inner_instructions: {:#?}", result.inner_instructions);

    println!("\n📝 Transaction Logs:");
    for log in &result.logs {
        println!("  {}", log);
    }

    if result.is_ok() {
        // Verify ATA was created
        let ata_account = result.account(&ata_address);
        if let Some(ata) = ata_account {
            println!("\n✅ ATA created successfully!");
            println!("  Address: {}", ata_address);
            println!("  Owner: {}", ata.owner);
            println!("  Lamports: {}", ata.lamports);
            println!("  Data length: {} bytes", ata.data.len());
        }
    }
}
