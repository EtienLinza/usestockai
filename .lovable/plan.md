

# Unify UI Across All Pages

## Issues Found

1. **NotFound page** — completely unstyled (uses `bg-muted`, no Navbar, no brand presence, no animations)
2. **TabsList styling inconsistent** — Dashboard uses default `bg-muted`, Guide uses `bg-secondary/30`; Dashboard has `flex-wrap h-auto gap-1`, Guide doesn't
3. **Page header patterns vary** — Dashboard: `text-xl sm:text-2xl`, Guide: same but wrapped differently, Watchlist: same text but different layout structure
4. **Background glow position differs** per page — some use `top-1/4`, others `top-1/3`, different sizes. Minor but noticeable
5. **Container max-width inconsistent** — Dashboard: `max-w-7xl`, Guide: `max-w-6xl`, Watchlist: `max-w-4xl`; the narrowness makes Watchlist feel like a different app
6. **Empty state patterns differ** — Dashboard signals: uses `Card variant="glass"`, Watchlist empty: uses `glass-card` class directly. Both should use same pattern
7. **Card usage mixed** — Some places use `Card variant="glass"`, others use `className="glass-card"`. Should be consistent
8. **Input glow color mismatch** — Input `glow` variant references `hsl(187 100% 42%)` (cyan) shadow, but the app's primary is sage green `hsl(143 35% 45%)`. This is a leftover from an older theme
9. **Footer only on Landing** — no footer on inner pages, which is fine, but Landing footer is very minimal
10. **Motion initial animation values differ** — Dashboard header: `y: 10`, Guide/Watchlist: `y: 16`. Small but contributes to feel

## Plan

### 1. Fix Input glow shadow color (input.tsx)
Change the glow variant's `focus-visible:shadow` from the cyan `hsl(187 100% 42%)` to the sage green `hsl(143 35% 45%)` to match the theme.

### 2. Standardize TabsList styling
- Update Dashboard's TabsList to use `bg-secondary/30` (matching Guide)
- Keep both with consistent padding/wrapping approach

### 3. Unify container max-widths
- Dashboard stays `max-w-7xl` (needs the space for its complex layout)
- Guide → `max-w-7xl` (matching Dashboard since it has similar card grids)
- Watchlist → `max-w-5xl` (slightly wider for better proportion)

### 4. Standardize Card usage
Replace all `className="glass-card"` with `Card variant="glass"` or `Card className="glass-card"` consistently. Prefer `variant="glass"` since the component supports it.

### 5. Redesign NotFound page
Replace the bare unstyled page with a branded 404 that includes:
- `bg-background` (not `bg-muted`)
- Logo
- Consistent typography
- Subtle background glow
- "Return to Dashboard" button with proper styling
- Motion animation matching other pages

### 6. Normalize motion animation values
Standardize all page header entry animations to `y: 16` across Dashboard, Guide, Watchlist.

### 7. Unify background glow positioning
All inner pages use the same glow: `top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-primary/2 rounded-full blur-[150px]`

### 8. Consistent empty states
Ensure all empty state patterns use `Card variant="glass"` with the same icon-in-circle + heading + description pattern.

## Files Changed

1. **`src/components/ui/input.tsx`** — fix glow shadow color from cyan to sage green
2. **`src/pages/Dashboard.tsx`** — TabsList `bg-secondary/30`, header animation `y: 16`
3. **`src/pages/Guide.tsx`** — container `max-w-7xl`, standardize glow position
4. **`src/pages/Watchlist.tsx`** — container `max-w-5xl`, ensure `Card variant="glass"` usage, standardize glow position
5. **`src/pages/NotFound.tsx`** — full redesign with branding, Logo, motion, and proper theme

