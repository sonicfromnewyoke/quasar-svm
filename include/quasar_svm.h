#ifndef QUASAR_SVM_H
#define QUASAR_SVM_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#define QUASAR_OK 0

#define QUASAR_ERR_NULL_POINTER -1

#define QUASAR_ERR_INVALID_UTF8 -2

#define QUASAR_ERR_PROGRAM_LOAD -3

#define QUASAR_ERR_EXECUTION -4

#define QUASAR_ERR_OUT_OF_BOUNDS -5

#define QUASAR_ERR_INTERNAL -99

const char *quasar_last_error(void);

QuasarSvm *quasar_svm_new(void);

void quasar_svm_free(QuasarSvm *svm);

int32_t quasar_svm_add_program(QuasarSvm *svm,
                               const uint8_t (*program_id)[32],
                               const uint8_t *elf_data,
                               uint64_t elf_len,
                               uint8_t loader_version);

int32_t quasar_svm_set_clock(QuasarSvm *svm,
                             uint64_t slot,
                             int64_t epoch_start_timestamp,
                             uint64_t epoch,
                             uint64_t leader_schedule_epoch,
                             int64_t unix_timestamp);

int32_t quasar_svm_warp_to_slot(QuasarSvm *svm, uint64_t slot);

int32_t quasar_svm_warp_to_timestamp(QuasarSvm *svm, int64_t timestamp);

int32_t quasar_svm_set_rent(QuasarSvm *svm,
                            uint64_t lamports_per_byte_year,
                            double exemption_threshold,
                            uint8_t burn_percent);

int32_t quasar_svm_set_epoch_schedule(QuasarSvm *svm,
                                      uint64_t slots_per_epoch,
                                      uint64_t leader_schedule_slot_offset,
                                      bool warmup,
                                      uint64_t first_normal_epoch,
                                      uint64_t first_normal_slot);

int32_t quasar_svm_set_compute_budget(QuasarSvm *svm, uint64_t max_units);

/**
 * Store an account in the SVM's account database.
 * The account is provided as raw fields (Account-style).
 */
int32_t quasar_svm_set_account(QuasarSvm *svm,
                               const uint8_t (*pubkey)[32],
                               const uint8_t (*owner)[32],
                               uint64_t lamports,
                               const uint8_t *data,
                               uint64_t data_len,
                               bool executable);

/**
 * Read an account from the SVM's account database.
 * Returns serialized Account data via out-pointers, or QUASAR_ERR_EXECUTION if not found.
 */
int32_t quasar_svm_get_account(const QuasarSvm *svm,
                               const uint8_t (*pubkey)[32],
                               uint8_t **result_out,
                               uint64_t *result_len_out);

/**
 * Give lamports to an account, creating it if needed (system program owned).
 */
int32_t quasar_svm_airdrop(QuasarSvm *svm, const uint8_t (*pubkey)[32], uint64_t lamports);

/**
 * Create a rent-exempt account with the given space and owner.
 */
int32_t quasar_svm_create_account(QuasarSvm *svm,
                                  const uint8_t (*pubkey)[32],
                                  uint64_t space,
                                  const uint8_t (*owner)[32]);

/**
 * Set the token balance (amount) of an existing token account in the store.
 * Returns QUASAR_ERR_EXECUTION if the account is not found or not a valid token account.
 */
int32_t quasar_svm_set_token_balance(QuasarSvm *svm, const uint8_t (*pubkey)[32], uint64_t amount);

/**
 * Set the supply of an existing mint account in the store.
 * Returns QUASAR_ERR_EXECUTION if the account is not found or not a valid mint account.
 */
int32_t quasar_svm_set_mint_supply(QuasarSvm *svm, const uint8_t (*pubkey)[32], uint64_t supply);

/**
 * Execute a transaction without committing state changes.
 */
int32_t quasar_svm_simulate_transaction(QuasarSvm *svm,
                                        const uint8_t *instructions,
                                        uint64_t instructions_len,
                                        const uint8_t *accounts,
                                        uint64_t accounts_len,
                                        uint8_t **result_out,
                                        uint64_t *result_len_out);

/**
 * Execute multiple instructions as a single atomic transaction.
 *
 * `instructions` / `instructions_len`: count-prefixed serialized instructions.
 * `accounts` / `accounts_len`: serialized accounts (wire format).
 */
int32_t quasar_svm_process_transaction(QuasarSvm *svm,
                                       const uint8_t *instructions,
                                       uint64_t instructions_len,
                                       const uint8_t *accounts,
                                       uint64_t accounts_len,
                                       uint8_t **result_out,
                                       uint64_t *result_len_out);

/**
 * Free a serialized result buffer previously returned by an execution function.
 * Both the pointer and the length from the execution call must be provided.
 */
void quasar_result_free(uint8_t *result, uint64_t result_len);

#endif  /* QUASAR_SVM_H */
