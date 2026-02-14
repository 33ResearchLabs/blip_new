# Dashboard Refactor - Implementation Steps

## ✅ COMPLETED
- ✅ Global CSS with `body.dashboard-layout` class
- ✅ All 5 panel components created
- ✅ TransactionsTab component
- ✅ Ledger API endpoints
- ✅ Database migration (022_ledger_entries.sql)
- ✅ Components imported in page.tsx

## 📝 REMAINING STEPS

### Step 1: Add body class toggle

Find line ~720 (after merchant info loading effects) and add this useEffect:

```tsx
// Add body.dashboard-layout class when logged in
useEffect(() => {
  if (isLoggedIn && merchantId) {
    document.body.classList.add('dashboard-layout');
  } else {
    document.body.classList.remove('dashboard-layout');
  }

  return () => {
    document.body.classList.remove('dashboard-layout');
  };
}, [isLoggedIn, merchantId]);
```

### Step 2: Add state for pending orders panel

Find where other state variables are defined (around line 460-600) and add:

```tsx
const [pendingFilter, setPendingFilter] = useState<'all' | 'mineable' | 'premium' | 'large' | 'expiring'>('all');
const [pendingSortBy, setPendingSortBy] = useState<'time' | 'premium' | 'amount' | 'rating'>('time');
```

### Step 3: Replace the desktop layout

**Find line 3471:** Look for this line:
```tsx
<div className="hidden md:grid gap-4" style={{ gridTemplateColumns: 'minmax(220px, 3fr) 3.85fr 3.15fr' }}>
```

**Replace the entire desktop layout section (lines 3471-6000 approximately) with:**

```tsx
{/* DESKTOP: 3-Column Non-Scrollable Layout */}
<div className="hidden md:grid h-screen overflow-hidden" style={{ gridTemplateColumns: '25% 45% 30%' }}>
  {/* LEFT COLUMN: Config Panel (25%) */}
  <div className="flex flex-col border-r border-white/[0.06] bg-[#0a0a0a]">
    <ConfigPanel
      merchantId={merchantId}
      merchantInfo={merchantInfo}
      effectiveBalance={effectiveBalance}
      openTradeForm={openTradeForm}
      setOpenTradeForm={setOpenTradeForm}
      isCreatingTrade={isCreatingTrade}
      setShowOpenTradeModal={setShowOpenTradeModal}
      refreshBalance={refreshBalance}
    />
  </div>

  {/* CENTER COLUMN: Pending (60%) + Leaderboard (40%) */}
  <div className="flex flex-col border-r border-white/[0.06] bg-black">
    {/* Pending Orders: 60% height */}
    <div style={{ height: '60%' }} className="flex flex-col border-b border-white/[0.06]">
      <PendingOrdersPanel
        orders={pendingOrders}
        mempoolOrders={mempoolOrders}
        merchantInfo={merchantInfo}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        pendingFilter={pendingFilter}
        setPendingFilter={setPendingFilter}
        pendingSortBy={pendingSortBy}
        setPendingSortBy={setPendingSortBy}
        soundEnabled={soundEnabled}
        setSoundEnabled={setSoundEnabled}
        showOrderFilters={showOrderFilters}
        setShowOrderFilters={setShowOrderFilters}
        orderFilters={orderFilters}
        setOrderFilters={setOrderFilters}
        onSelectOrder={setSelectedOrderPopup}
        onSelectMempoolOrder={setSelectedMempoolOrder}
        fetchOrders={fetchOrders}
        orderViewFilter={orderViewFilter}
        setOrderViewFilter={setOrderViewFilter}
      />
    </div>

    {/* Leaderboard: 40% height */}
    <div style={{ height: '40%' }} className="flex flex-col">
      <LeaderboardPanel
        leaderboardData={leaderboardData}
        leaderboardTab={leaderboardTab}
        setLeaderboardTab={setLeaderboardTab}
      />
    </div>
  </div>

  {/* RIGHT COLUMN: In Progress (35%) + Activity (65%) */}
  <div className="flex flex-col bg-[#0a0a0a]">
    {/* In Progress: 35% height */}
    <div style={{ height: '35%' }} className="flex flex-col border-b border-white/[0.06]">
      <InProgressPanel
        orders={ongoingOrders}
        onSelectOrder={setSelectedOrderPopup}
      />
    </div>

    {/* Activity Panel: 65% height */}
    <div style={{ height: '65%' }} className="flex flex-col">
      <ActivityPanel
        merchantId={merchantId}
        completedOrders={completedOrders}
        onRateOrder={(order) => {
          const userName = order.user || 'User';
          const counterpartyType = order.isM2M ? 'merchant' : 'user';
          setRatingModalData({
            orderId: order.id,
            counterpartyName: userName,
            counterpartyType,
          });
        }}
      />
    </div>
  </div>
</div>
```

**IMPORTANT:** Make sure to keep the mobile layout section that comes after this. Only replace the desktop `hidden md:grid` section.

### Step 4: Add keyboard shortcuts

Find the end of the component (before the return statement closing tag) and add:

```tsx
// Keyboard shortcuts
useEffect(() => {
  const handleKeyPress = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isInputField = ['INPUT', 'TEXTAREA'].includes(target.tagName);

    // "/" to focus search
    if (e.key === '/' && !isInputField) {
      e.preventDefault();
      const searchInput = document.querySelector<HTMLInputElement>('input[type="text"][placeholder*="Search"]');
      searchInput?.focus();
    }

    // "A" to accept selected order (if one is selected)
    if ((e.key === 'a' || e.key === 'A') && !isInputField && selectedOrderPopup) {
      // Handle accept action
      console.log('Accept order:', selected OrderPopup.id);
    }

    // "R" to refresh orders
    if ((e.key === 'r' || e.key === 'R') && !isInputField && !(e.metaKey || e.ctrlKey)) {
      fetchOrders();
    }
  };

  window.addEventListener('keydown', handleKeyPress);
  return () => window.removeEventListener('keydown', handleKeyPress);
}, [selectedOrderPopup, fetchOrders]);
```

### Step 5: Run database migration

```bash
# For local development
psql -d your_database -f settle/database/migrations/022_ledger_entries.sql

# For Railway (add to railway-migration.sql)
cat settle/database/migrations/022_ledger_entries.sql >> settle/database/railway-migration.sql
```

### Step 6: Test checklist

- [ ] Page never scrolls (body has `overflow: hidden`)
- [ ] Left config panel scrolls internally
- [ ] Center pending orders list scrolls
- [ ] Center leaderboard list scrolls
- [ ] Right in-progress list scrolls
- [ ] Right activity panel scrolls
- [ ] Tabs switch (Pending/All, Completed/Transactions)
- [ ] Transactions tab loads and displays ledger
- [ ] Quick filters work
- [ ] Search works
- [ ] Sort works
- [ ] Keyboard shortcuts work (/, r)
- [ ] Sound toggle works
- [ ] Refresh button works
- [ ] All existing modals still work
- [ ] Mobile view still works (unchanged)

## 🎨 Visual Verification

The layout should look like this:

```
┌──────────────────────────────────────────────────────────────┐
│                      Top Navbar (unchanged)                  │
├───────────┬──────────────────────┬───────────────────────────┤
│   LEFT    │       CENTER         │         RIGHT             │
│   25%     │       45%            │         30%               │
│           │                      │                           │
│  Config   │ ┌──────────────────┐ │ ┌───────────────────────┐│
│           │ │ Pending (60%)    │ │ │ In Progress (35%)     ││
│  Balance  │ │ - Tabs           │ │ │ - Orders              ││
│  Buy/Sell │ │ - Filters        │ │ │ - Timers              ││
│  Amount   │ │ - Search         │ │ │ - Next Actions        ││
│  Payment  │ │ - Sort           │ │ └───────────────────────┘│
│  Fee      │ │ - Orders (scroll)│ │ ┌───────────────────────┐│
│  Create   │ └──────────────────┘ │ │ Activity (65%)        ││
│           │ ┌──────────────────┐ │ │ - Tabs:               ││
│  (scroll) │ │ Leaderboard(40%) │ │ │   Completed           ││
│           │ │ - Traders/Rated  │ │ │   Transactions        ││
│           │ │ - List (scroll)  │ │ │ - List (scroll)       ││
│           │ └──────────────────┘ │ └───────────────────────┘│
└───────────┴──────────────────────┴───────────────────────────┘
```

## 🚨 Common Issues & Fixes

### Issue: Page still scrolls
**Fix:** Make sure `body.dashboard-layout` class is being added. Check browser devtools.

### Issue: Panels overflow
**Fix:** Ensure parent div has `h-screen overflow-hidden` and each column uses proper height percentages.

### Issue: Lists don't scroll
**Fix:** Each list container needs `overflow-y-auto` and parent needs fixed height.

### Issue: Transactions tab shows "No transactions"
**Fix:** Run the ledger migration first. Check `/api/ledger?merchant_id=XXX` in browser.

### Issue: Mobile layout broken
**Fix:** Make sure you only replaced the `hidden md:grid` section, not the mobile views.

### Issue: Existing features broken
**Fix:** The new layout should only affect desktop. All modals, chats, and mobile features should still work. Check if you accidentally removed state or handlers.

## 📚 Reference Files

- [DASHBOARD_REFACTOR_GUIDE.md](./DASHBOARD_REFACTOR_GUIDE.md) - Full implementation guide
- [ConfigPanel.tsx](./src/components/merchant/ConfigPanel.tsx)
- [PendingOrdersPanel.tsx](./src/components/merchant/PendingOrdersPanel.tsx)
- [LeaderboardPanel.tsx](./src/components/merchant/LeaderboardPanel.tsx)
- [InProgressPanel.tsx](./src/components/merchant/InProgressPanel.tsx)
- [ActivityPanel.tsx](./src/components/merchant/ActivityPanel.tsx)
- [TransactionsTab.tsx](./src/components/merchant/TransactionsTab.tsx)
- [022_ledger_entries.sql](./database/migrations/022_ledger_entries.sql)
- [/api/ledger/route.ts](./src/app/api/ledger/route.ts)

## ✨ Success Criteria

When done correctly:
1. ✅ Desktop view is non-scrollable (100vh fixed)
2. ✅ 3-column layout with correct proportions (25/45/30)
3. ✅ Each panel has internal scrolling only
4. ✅ Transactions tab displays ledger entries
5. ✅ All filters, search, and sort work
6. ✅ Keyboard shortcuts functional
7. ✅ Mobile view unchanged and working
8. ✅ All existing features preserved
