package quasarsvm

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"

	"github.com/gagliardetto/solana-go"
)

// serializeInstructions encodes instructions into the wire format.
func serializeInstructions(ixs []Instruction) []byte {
	// Pre-calculate exact size: 4 (count) + per-ix (32 + 4 + dataLen + 4 + metas*34)
	size := 4
	for i := range ixs {
		size += 32 + 4 + len(ixs[i].Data) + 4 + len(ixs[i].Accounts)*34
	}

	buf := make([]byte, 0, size)

	// Count prefix
	buf = binary.LittleEndian.AppendUint32(buf, uint32(len(ixs)))

	for i := range ixs {
		ix := &ixs[i]
		// Program ID (32 bytes)
		buf = append(buf, ix.ProgramID[:]...)

		// Data (length-prefixed)
		buf = binary.LittleEndian.AppendUint32(buf, uint32(len(ix.Data)))
		buf = append(buf, ix.Data...)

		// Account metas
		buf = binary.LittleEndian.AppendUint32(buf, uint32(len(ix.Accounts)))
		for j := range ix.Accounts {
			buf = append(buf, ix.Accounts[j].PublicKey[:]...)
			buf = appendBool(buf, ix.Accounts[j].IsSigner)
			buf = appendBool(buf, ix.Accounts[j].IsWritable)
		}
	}

	return buf
}

// serializeAccounts encodes accounts into the wire format.
func serializeAccounts(accounts []Account) []byte {
	// Pre-calculate exact size: 4 (count) + per-acct (32 + 32 + 8 + 4 + dataLen + 1)
	size := 4
	for i := range accounts {
		size += 77 + len(accounts[i].Data)
	}

	buf := make([]byte, 0, size)

	// Count prefix
	buf = binary.LittleEndian.AppendUint32(buf, uint32(len(accounts)))

	for i := range accounts {
		acct := &accounts[i]
		buf = append(buf, acct.Address[:]...)
		buf = append(buf, acct.Owner[:]...)
		buf = binary.LittleEndian.AppendUint64(buf, acct.Lamports)
		buf = binary.LittleEndian.AppendUint32(buf, uint32(len(acct.Data)))
		buf = append(buf, acct.Data...)
		buf = appendBool(buf, acct.Executable)
	}

	return buf
}

// deserializeResult decodes the wire format result into an ExecutionResult.
func deserializeResult(data []byte) (*ExecutionResult, error) {
	r := &reader{data: data}

	status, err := r.readI32()
	if err != nil {
		return nil, fmt.Errorf("reading status: %w", err)
	}
	computeUnits, err := r.readU64()
	if err != nil {
		return nil, fmt.Errorf("reading compute units: %w", err)
	}
	executionTimeUs, err := r.readU64()
	if err != nil {
		return nil, fmt.Errorf("reading execution time: %w", err)
	}

	// Return data
	returnData, err := r.readLengthPrefixed()
	if err != nil {
		return nil, fmt.Errorf("reading return data: %w", err)
	}

	// Accounts
	numAccounts, err := r.readU32()
	if err != nil {
		return nil, fmt.Errorf("reading account count: %w", err)
	}
	accounts := make([]Account, numAccounts)
	for i := range numAccounts {
		pubkey, err := r.readPubkey()
		if err != nil {
			return nil, fmt.Errorf("reading account %d address: %w", i, err)
		}
		owner, err := r.readPubkey()
		if err != nil {
			return nil, fmt.Errorf("reading account %d owner: %w", i, err)
		}
		lamports, err := r.readU64()
		if err != nil {
			return nil, fmt.Errorf("reading account %d lamports: %w", i, err)
		}
		acctData, err := r.readLengthPrefixed()
		if err != nil {
			return nil, fmt.Errorf("reading account %d data: %w", i, err)
		}
		executable, err := r.readBool()
		if err != nil {
			return nil, fmt.Errorf("reading account %d executable: %w", i, err)
		}
		accounts[i] = Account{
			Address:    pubkey,
			Owner:      owner,
			Lamports:   lamports,
			Data:       acctData,
			Executable: executable,
		}
	}

	// Logs
	numLogs, err := r.readU32()
	if err != nil {
		return nil, fmt.Errorf("reading log count: %w", err)
	}
	logs := make([]string, numLogs)
	for i := range numLogs {
		logData, err := r.readLengthPrefixed()
		if err != nil {
			return nil, fmt.Errorf("reading log %d: %w", i, err)
		}
		logs[i] = string(logData)
	}

	// Error message
	emLen, err := r.readU32()
	if err != nil {
		return nil, fmt.Errorf("reading error message length: %w", err)
	}
	var errorMessage *string
	if emLen > 0 {
		emBytes, err := r.readBytes(int(emLen))
		if err != nil {
			return nil, fmt.Errorf("reading error message: %w", err)
		}
		msg := string(emBytes)
		errorMessage = &msg
	}

	// Pre-balances
	numPreBalances, err := r.readU32()
	if err != nil {
		return nil, fmt.Errorf("reading pre-balance count: %w", err)
	}
	preBalances := make([]uint64, numPreBalances)
	for i := range numPreBalances {
		preBalances[i], err = r.readU64()
		if err != nil {
			return nil, fmt.Errorf("reading pre-balance %d: %w", i, err)
		}
	}

	// Post-balances
	numPostBalances, err := r.readU32()
	if err != nil {
		return nil, fmt.Errorf("reading post-balance count: %w", err)
	}
	postBalances := make([]uint64, numPostBalances)
	for i := range numPostBalances {
		postBalances[i], err = r.readU64()
		if err != nil {
			return nil, fmt.Errorf("reading post-balance %d: %w", i, err)
		}
	}

	// Pre-token balances
	preTokenBalances, err := readTokenBalances(r)
	if err != nil {
		return nil, fmt.Errorf("reading pre-token balances: %w", err)
	}

	// Post-token balances
	postTokenBalances, err := readTokenBalances(r)
	if err != nil {
		return nil, fmt.Errorf("reading post-token balances: %w", err)
	}

	// Execution trace
	numInstructions, err := r.readU32()
	if err != nil {
		return nil, fmt.Errorf("reading trace count: %w", err)
	}
	traceInstructions := make([]ExecutedInstruction, numInstructions)
	for i := range numInstructions {
		stackDepth, err := r.readU8()
		if err != nil {
			return nil, fmt.Errorf("reading trace %d stack depth: %w", i, err)
		}

		programID, err := r.readPubkey()
		if err != nil {
			return nil, fmt.Errorf("reading trace %d program ID: %w", i, err)
		}
		numAcctMetas, err := r.readU32()
		if err != nil {
			return nil, fmt.Errorf("reading trace %d account count: %w", i, err)
		}
		acctMetas := make([]AccountMeta, numAcctMetas)
		for j := range numAcctMetas {
			pk, err := r.readPubkey()
			if err != nil {
				return nil, fmt.Errorf("reading trace %d account %d: %w", i, j, err)
			}
			isSigner, err := r.readBool()
			if err != nil {
				return nil, fmt.Errorf("reading trace %d account %d is_signer: %w", i, j, err)
			}
			isWritable, err := r.readBool()
			if err != nil {
				return nil, fmt.Errorf("reading trace %d account %d is_writable: %w", i, j, err)
			}
			acctMetas[j] = AccountMeta{
				PublicKey:  pk,
				IsSigner:  isSigner,
				IsWritable: isWritable,
			}
		}
		ixData, err := r.readLengthPrefixed()
		if err != nil {
			return nil, fmt.Errorf("reading trace %d data: %w", i, err)
		}

		cuConsumed, err := r.readU64()
		if err != nil {
			return nil, fmt.Errorf("reading trace %d compute units: %w", i, err)
		}
		result, err := r.readU64()
		if err != nil {
			return nil, fmt.Errorf("reading trace %d result: %w", i, err)
		}

		traceInstructions[i] = ExecutedInstruction{
			StackDepth: stackDepth,
			Instruction: Instruction{
				ProgramID: programID,
				Accounts:  acctMetas,
				Data:      ixData,
			},
			ComputeUnitsConsumed: cuConsumed,
			Result:               result,
		}
	}

	return &ExecutionResult{
		Status:            status,
		ComputeUnits:      computeUnits,
		ExecutionTimeUs:   executionTimeUs,
		ReturnData:        returnData,
		Accounts:          accounts,
		Logs:              logs,
		ErrorMessage:      errorMessage,
		PreBalances:       preBalances,
		PostBalances:      postBalances,
		PreTokenBalances:  preTokenBalances,
		PostTokenBalances: postTokenBalances,
		ExecutionTrace:    ExecutionTrace{Instructions: traceInstructions},
	}, nil
}

func readTokenBalances(r *reader) ([]TokenBalance, error) {
	count, err := r.readU32()
	if err != nil {
		return nil, err
	}
	balances := make([]TokenBalance, count)
	for i := range count {
		accountIndex, err := r.readU32()
		if err != nil {
			return nil, fmt.Errorf("token balance %d account index: %w", i, err)
		}
		mintData, err := r.readLengthPrefixed()
		if err != nil {
			return nil, fmt.Errorf("token balance %d mint: %w", i, err)
		}
		mint := string(mintData)

		hasOwner, err := r.readBool()
		if err != nil {
			return nil, fmt.Errorf("token balance %d has_owner: %w", i, err)
		}
		var owner *string
		if hasOwner {
			ownerData, err := r.readLengthPrefixed()
			if err != nil {
				return nil, fmt.Errorf("token balance %d owner: %w", i, err)
			}
			o := string(ownerData)
			owner = &o
		}

		decimals, err := r.readU8()
		if err != nil {
			return nil, fmt.Errorf("token balance %d decimals: %w", i, err)
		}
		amountData, err := r.readLengthPrefixed()
		if err != nil {
			return nil, fmt.Errorf("token balance %d amount: %w", i, err)
		}
		amount := string(amountData)

		hasUIAmount, err := r.readBool()
		if err != nil {
			return nil, fmt.Errorf("token balance %d has_ui_amount: %w", i, err)
		}
		var uiAmount *float64
		if hasUIAmount {
			v, err := r.readF64()
			if err != nil {
				return nil, fmt.Errorf("token balance %d ui_amount: %w", i, err)
			}
			uiAmount = &v
		}

		balances[i] = TokenBalance{
			AccountIndex: accountIndex,
			Mint:         mint,
			Owner:        owner,
			Decimals:     decimals,
			Amount:       amount,
			UIAmount:     uiAmount,
		}
	}
	return balances, nil
}

var errUnexpectedEOF = errors.New("unexpected end of wire data")

// reader is a binary reader for the wire format with bounds checking.
type reader struct {
	data []byte
	pos  int
}

func (r *reader) remaining() int {
	return len(r.data) - r.pos
}

func (r *reader) readBytes(n int) ([]byte, error) {
	if r.remaining() < n {
		return nil, errUnexpectedEOF
	}
	// Return a sub-slice of the underlying data (already copied from FFI buffer).
	b := r.data[r.pos : r.pos+n]
	r.pos += n
	return b, nil
}

func (r *reader) readU8() (uint8, error) {
	if r.remaining() < 1 {
		return 0, errUnexpectedEOF
	}
	v := r.data[r.pos]
	r.pos++
	return v, nil
}

func (r *reader) readBool() (bool, error) {
	v, err := r.readU8()
	return v != 0, err
}

func (r *reader) readU32() (uint32, error) {
	if r.remaining() < 4 {
		return 0, errUnexpectedEOF
	}
	v := binary.LittleEndian.Uint32(r.data[r.pos:])
	r.pos += 4
	return v, nil
}

func (r *reader) readI32() (int32, error) {
	v, err := r.readU32()
	return int32(v), err
}

func (r *reader) readU64() (uint64, error) {
	if r.remaining() < 8 {
		return 0, errUnexpectedEOF
	}
	v := binary.LittleEndian.Uint64(r.data[r.pos:])
	r.pos += 8
	return v, nil
}

func (r *reader) readF64() (float64, error) {
	bits, err := r.readU64()
	if err != nil {
		return 0, err
	}
	return math.Float64frombits(bits), nil
}

func (r *reader) readPubkey() (solana.PublicKey, error) {
	if r.remaining() < 32 {
		return solana.PublicKey{}, errUnexpectedEOF
	}
	var pk solana.PublicKey
	copy(pk[:], r.data[r.pos:r.pos+32])
	r.pos += 32
	return pk, nil
}

func (r *reader) readLengthPrefixed() ([]byte, error) {
	n, err := r.readU32()
	if err != nil {
		return nil, err
	}
	return r.readBytes(int(n))
}

func appendBool(buf []byte, v bool) []byte {
	if v {
		return append(buf, 1)
	}
	return append(buf, 0)
}
