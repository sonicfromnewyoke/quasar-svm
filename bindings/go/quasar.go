// Package quasarsvm provides Go bindings for the Quasar SVM — a lightweight
// Solana virtual machine that executes transactions locally without an RPC
// connection. It uses github.com/gagliardetto/solana-go for Solana types.
//
// The native library (libquasar_svm) must be built before using this package:
//
//	cargo build --release -p quasar-svm-ffi
//
// Set CGO_LDFLAGS and CGO_CFLAGS if the library is not in the default search path:
//
//	export CGO_LDFLAGS="-L/path/to/target/release"
//	export CGO_CFLAGS="-I/path/to/include"
package quasarsvm

/*
#cgo LDFLAGS: -lquasar_svm
#cgo darwin LDFLAGS: -Wl,-rpath,${SRCDIR}/../../target/release
#cgo linux LDFLAGS: -Wl,-rpath,${SRCDIR}/../../target/release

#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>

typedef struct QuasarSvm QuasarSvm;

const char *quasar_last_error(void);
QuasarSvm *quasar_svm_new(void);
void quasar_svm_free(QuasarSvm *svm);

int32_t quasar_svm_add_program(
    QuasarSvm *svm,
    const uint8_t (*program_id)[32],
    const uint8_t *elf_data,
    uint64_t elf_len,
    uint8_t loader_version
);

int32_t quasar_svm_set_clock(
    QuasarSvm *svm,
    uint64_t slot,
    int64_t epoch_start_timestamp,
    uint64_t epoch,
    uint64_t leader_schedule_epoch,
    int64_t unix_timestamp
);

int32_t quasar_svm_warp_to_slot(QuasarSvm *svm, uint64_t slot);
int32_t quasar_svm_set_rent(QuasarSvm *svm, uint64_t lamports_per_byte_year);

int32_t quasar_svm_set_epoch_schedule(
    QuasarSvm *svm,
    uint64_t slots_per_epoch,
    uint64_t leader_schedule_slot_offset,
    bool warmup,
    uint64_t first_normal_epoch,
    uint64_t first_normal_slot
);

int32_t quasar_svm_set_compute_budget(QuasarSvm *svm, uint64_t max_units);

int32_t quasar_svm_process_transaction(
    QuasarSvm *svm,
    const uint8_t *instructions,
    uint64_t instructions_len,
    const uint8_t *accounts,
    uint64_t accounts_len,
    uint8_t **result_out,
    uint64_t *result_len_out
);

void quasar_result_free(uint8_t *result, uint64_t result_len);
*/
import "C"

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"unsafe"

	"github.com/gagliardetto/solana-go"
)

var (
	errFreed    = errors.New("quasar-svm: use after Free")
	errEmptyELF = errors.New("quasar-svm: empty ELF data")
)

// QuasarSVM is a lightweight Solana virtual machine for local transaction execution.
type QuasarSVM struct {
	ptr   *C.QuasarSvm
	freed bool
}

// New creates a new QuasarSVM instance with default SPL programs loaded
// (Token, Token-2022, Associated Token Account).
// Returns an error if the program ELF files cannot be found or loaded.
func New() (*QuasarSVM, error) {
	svm, err := NewWithoutPrograms()
	if err != nil {
		return nil, err
	}

	programsDir := findProgramsDir()

	programs := []struct {
		id      solana.PublicKey
		file    string
		loader  uint8
	}{
		{solana.TokenProgramID, "spl_token.so", LoaderV2},
		{solana.Token2022ProgramID, "spl_token_2022.so", LoaderV3},
		{solana.SPLAssociatedTokenAccountProgramID, "spl_associated_token.so", LoaderV2},
	}

	for _, p := range programs {
		elf, err := os.ReadFile(filepath.Join(programsDir, p.file))
		if err != nil {
			svm.Free()
			return nil, fmt.Errorf("reading %s: %w", p.file, err)
		}
		if err := svm.AddProgram(p.id, elf, p.loader); err != nil {
			svm.Free()
			return nil, fmt.Errorf("loading %s: %w", p.file, err)
		}
	}

	return svm, nil
}

// NewWithoutPrograms creates a new QuasarSVM instance without loading any SPL programs.
func NewWithoutPrograms() (*QuasarSVM, error) {
	ptr := C.quasar_svm_new()
	if ptr == nil {
		return nil, fmt.Errorf("failed to create QuasarSVM: %s", lastError())
	}

	svm := &QuasarSVM{ptr: ptr}
	runtime.SetFinalizer(svm, (*QuasarSVM).Free)
	return svm, nil
}

// Free releases the native SVM resources. Safe to call multiple times.
func (s *QuasarSVM) Free() {
	if !s.freed && s.ptr != nil {
		C.quasar_svm_free(s.ptr)
		s.freed = true
		runtime.SetFinalizer(s, nil)
	}
}

func (s *QuasarSVM) ensureAlive() error {
	if s.freed {
		return errFreed
	}
	return nil
}

// AddProgram loads a BPF program into the SVM.
func (s *QuasarSVM) AddProgram(programID solana.PublicKey, elf []byte, loaderVersion uint8) error {
	if err := s.ensureAlive(); err != nil {
		return err
	}
	if len(elf) == 0 {
		return errEmptyELF
	}
	id := programID
	code := C.quasar_svm_add_program(
		s.ptr,
		(*[32]C.uint8_t)(unsafe.Pointer(&id[0])),
		(*C.uint8_t)(unsafe.Pointer(&elf[0])),
		C.uint64_t(len(elf)),
		C.uint8_t(loaderVersion),
	)
	return s.check(code)
}

// SetClock configures the Clock sysvar.
func (s *QuasarSVM) SetClock(clock Clock) error {
	if err := s.ensureAlive(); err != nil {
		return err
	}
	code := C.quasar_svm_set_clock(
		s.ptr,
		C.uint64_t(clock.Slot),
		C.int64_t(clock.EpochStartTimestamp),
		C.uint64_t(clock.Epoch),
		C.uint64_t(clock.LeaderScheduleEpoch),
		C.int64_t(clock.UnixTimestamp),
	)
	return s.check(code)
}

// WarpToSlot advances the SVM to a future slot.
func (s *QuasarSVM) WarpToSlot(slot uint64) error {
	if err := s.ensureAlive(); err != nil {
		return err
	}
	return s.check(C.quasar_svm_warp_to_slot(s.ptr, C.uint64_t(slot)))
}

// SetRent configures the Rent sysvar.
func (s *QuasarSVM) SetRent(lamportsPerByteYear uint64) error {
	if err := s.ensureAlive(); err != nil {
		return err
	}
	return s.check(C.quasar_svm_set_rent(s.ptr, C.uint64_t(lamportsPerByteYear)))
}

// SetEpochSchedule configures the EpochSchedule sysvar.
func (s *QuasarSVM) SetEpochSchedule(schedule EpochSchedule) error {
	if err := s.ensureAlive(); err != nil {
		return err
	}
	code := C.quasar_svm_set_epoch_schedule(
		s.ptr,
		C.uint64_t(schedule.SlotsPerEpoch),
		C.uint64_t(schedule.LeaderScheduleSlotOffset),
		C.bool(schedule.Warmup),
		C.uint64_t(schedule.FirstNormalEpoch),
		C.uint64_t(schedule.FirstNormalSlot),
	)
	return s.check(code)
}

// SetComputeBudget sets the maximum compute units for execution.
func (s *QuasarSVM) SetComputeBudget(maxUnits uint64) error {
	if err := s.ensureAlive(); err != nil {
		return err
	}
	return s.check(C.quasar_svm_set_compute_budget(s.ptr, C.uint64_t(maxUnits)))
}

// ProcessInstruction executes a single instruction.
func (s *QuasarSVM) ProcessInstruction(ix Instruction, accounts []Account) (*ExecutionResult, error) {
	// Use a stack-allocated array to avoid heap escaping a 1-element slice.
	ixs := [1]Instruction{ix}
	return s.ProcessInstructionChain(ixs[:], accounts)
}

// ProcessInstructionChain executes multiple instructions atomically.
func (s *QuasarSVM) ProcessInstructionChain(ixs []Instruction, accounts []Account) (*ExecutionResult, error) {
	if err := s.ensureAlive(); err != nil {
		return nil, err
	}

	ixBuf := serializeInstructions(ixs)
	acctBuf := serializeAccounts(accounts)

	var resultPtr *C.uint8_t
	var resultLen C.uint64_t

	code := C.quasar_svm_process_transaction(
		s.ptr,
		(*C.uint8_t)(unsafe.Pointer(&ixBuf[0])),
		C.uint64_t(len(ixBuf)),
		(*C.uint8_t)(unsafe.Pointer(&acctBuf[0])),
		C.uint64_t(len(acctBuf)),
		&resultPtr,
		&resultLen,
	)

	if err := s.check(code); err != nil {
		return nil, err
	}

	// Copy the result data before freeing the FFI buffer
	goBytes := C.GoBytes(unsafe.Pointer(resultPtr), C.int(resultLen))
	C.quasar_result_free(resultPtr, resultLen)

	return deserializeResult(goBytes)
}

// ProcessSolanaInstruction executes a solana-go instruction interface.
func (s *QuasarSVM) ProcessSolanaInstruction(ix solana.Instruction, accounts []Account) (*ExecutionResult, error) {
	converted, err := fromSolanaInstruction(ix)
	if err != nil {
		return nil, fmt.Errorf("converting instruction: %w", err)
	}
	return s.ProcessInstruction(converted, accounts)
}

// ProcessSolanaInstructionChain executes multiple solana-go instructions atomically.
func (s *QuasarSVM) ProcessSolanaInstructionChain(ixs []solana.Instruction, accounts []Account) (*ExecutionResult, error) {
	converted := make([]Instruction, len(ixs))
	for i, ix := range ixs {
		var err error
		converted[i], err = fromSolanaInstruction(ix)
		if err != nil {
			return nil, fmt.Errorf("converting instruction %d: %w", i, err)
		}
	}
	return s.ProcessInstructionChain(converted, accounts)
}

func (s *QuasarSVM) check(code C.int32_t) error {
	if code != 0 {
		return fmt.Errorf("quasar-svm error (%d): %s", code, lastError())
	}
	return nil
}

func lastError() string {
	cstr := C.quasar_last_error()
	if cstr == nil {
		return "unknown"
	}
	return C.GoString(cstr)
}

// fromSolanaInstruction converts a solana-go Instruction to our Instruction type.
func fromSolanaInstruction(ix solana.Instruction) (Instruction, error) {
	data, err := ix.Data()
	if err != nil {
		return Instruction{}, fmt.Errorf("serializing instruction data: %w", err)
	}
	solAccounts := ix.Accounts()
	metas := make([]AccountMeta, len(solAccounts))
	for i, a := range solAccounts {
		metas[i] = AccountMeta{
			PublicKey:  a.PublicKey,
			IsSigner:  a.IsSigner,
			IsWritable: a.IsWritable,
		}
	}
	return Instruction{
		ProgramID: ix.ProgramID(),
		Accounts:  metas,
		Data:      data,
	}, nil
}

// findProgramsDir locates the bundled SPL program ELF files.
func findProgramsDir() string {
	// 1. QUASAR_SVM_PROGRAMS_DIR environment variable
	if dir := os.Getenv("QUASAR_SVM_PROGRAMS_DIR"); dir != "" {
		return dir
	}

	// 2. Relative to this source file (for development in the monorepo)
	// bindings/go/ -> ../../svm/programs/
	_, thisFile, _, _ := runtime.Caller(0)
	if thisFile != "" {
		dir := filepath.Join(filepath.Dir(thisFile), "..", "..", "svm", "programs")
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			return dir
		}
	}

	// 3. Current working directory fallback
	return "programs"
}
