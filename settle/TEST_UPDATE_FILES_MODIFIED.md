# Test Suite Update - Files Modified

## Summary
Updated test suite to use 8 minimal statuses. All tests now passing.

## Files Modified (7 total)

### Test Infrastructure (3 files)

1. **tests/unit/stateMachine.test.ts**
   - Updated test descriptions to reference minimal API statuses
   - Added comments explaining DB vs API layer mapping
   - Updated timeout expectations to reflect global 15-min timeout

2. **tests/flows/lib/types.ts**
   - Added `minimal_status?: string` field to Order interface
   - Enables backward compatibility during API transition

3. **tests/flows/lib/assertions.ts**
   - Added `getOrderStatus(order)` helper function
   - Added `assertOrderStatus(order, expectedMinimalStatus, context)` function
   - Provides single source of truth for status assertions

### Test Scenarios (4 files)

4. **tests/flows/scenarios/user-buy-happy.ts**
   - Updated flow: open → accepted → escrowed → payment_sent → completed
   - Removed payment_confirmed transition (now transient)
   - Updated all assertions to use `assertOrderStatus()`
   - Updated documentation

5. **tests/flows/scenarios/user-sell-happy.ts**
   - Updated flow: open → accepted → escrowed → payment_sent → completed
   - Removed payment_confirmed transition (now transient)
   - Updated all assertions to use `assertOrderStatus()`
   - Updated documentation

6. **tests/flows/scenarios/m2m-buy-happy.ts**
   - Updated flow: open → accepted → escrowed → payment_sent → completed
   - Removed payment_confirmed transition (now transient)
   - Updated all assertions to use `assertOrderStatus()`
   - Updated documentation

7. **tests/flows/scenarios/m2m-sell-happy.ts**
   - Updated flow: open → accepted → escrowed → payment_sent → completed
   - Removed payment_confirmed transition (now transient)
   - Updated all assertions to use `assertOrderStatus()`
   - Updated documentation

## Test Results

```bash
cd /Users/zeus/Documents/Vscode/BM/settle
pnpm test:flow
```

**Output:**
```
✓ User BUY - Happy Path      848ms
✓ User SELL - Happy Path     272ms
✓ M2M BUY - Happy Path       521ms
✓ M2M SELL - Happy Path      389ms

Total: 4 | Passed: 4 | Failed: 0 | Duration: 2030ms
```

## Key Changes

### Status Mapping
- `pending` → `open`
- `payment_confirmed` → removed (transient)
- `releasing` → removed (transient)

### Flow Simplification
- **Before:** 7 transitions per order
- **After:** 5 transitions per order
- **Reduction:** 28% fewer status changes

### Test Updates
- All assertions now use `assertOrderStatus()` helper
- Tests work with both `status` and `minimal_status` fields
- Backward compatible during API transition period

## Validation

The API now properly validates against transient statuses:

```
Error: Status 'payment_confirmed' is a transient status and cannot be written.
Use 'payment_sent' instead.
```

This ensures new code cannot accidentally use micro-statuses.

---

**Status:** ✅ All tests passing  
**Performance:** ~2 seconds for full test suite  
**Compatibility:** Backward compatible with DB layer
