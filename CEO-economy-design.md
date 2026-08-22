# CEO — Economy Design

Reference spec for the game's economic engine. Every formula and constant here has
been run through a simulator; the balance figures in §10 are measured output, not
estimates.

---

## 1. Design principles

**One engine, three levels.** Levels 1–3 run identical math. Only the *inputs*
change: whether shocks fire, whether the demand forecast is noisy, and whether
rivals share your market. Nothing a player learns in practice becomes false later.

**Legibility first.** A player should be able to reason their way to a good
decision, then check their reasoning against the result. Every formula is linear
or a single exponent — no black boxes.

**Every lever has an interior optimum.** For price, production, R&D, and capacity,
both "too little" and "too much" lose money. There is no lever you simply max out.
This was tested, not assumed (§10).

**Two-sided punishment.** Under-produce and you lose sales plus future customers.
Over-produce and you pay to hold and write down stock. The same is true of pricing,
R&D, and capacity. Every decision is a real decision.

---

## 2. State

**Each product carries:**

| Field | Meaning |
|---|---|
| `quality` | Index; 100 = market baseline expectation. Drives both price and reach. |
| `age` | Rounds since launch. Controls awareness ramp and maturity decline. |
| `inventory` / `inv_book` | Unsold units and their book value. |
| `cum_units` | Lifetime production — drives the learning curve. |
| `capacity` | Max units producible per round. |
| `rd_pipeline` | R&D spend in flight, with the round it lands. |

**Each company carries:** `cash`, `debt`, and its list of products.

---

## 3. Round structure

The order matters more than any single formula. It must be exactly this:

**Phase A — Upkeep.** Matured R&D lands. Purchased capacity comes online. Quality
decays 4%. Held inventory is written down 10%.

**Phase B — Decide.** The player sees the *post-upkeep* state and sets price,
production, R&D, capex, and any discontinuations.

**Phase C — Resolve.** Demand is computed, sales allocated, costs charged, cash
updated.

> **This ordering is load-bearing.** In an early build R&D landed *after* the
> player had already set price, so they were pricing against a quality number the
> engine had already changed. Decisions were quietly made on stale information.
> The player must always decide on the state they can see.

---

## 4. Demand

### Value

A product's value is what the market thinks it's worth:

```
value = $100 × (quality / 100)
```

### Price response (solo levels)

```
price_multiplier = max(0, 1 + 2.0 × (1 − price / value))
```

Legible enough to state in the UI: **every 10% you price below value wins about
20% more units.** Price at 150% of value and demand hits exactly zero.

### The demand pool

```
pool = 2000 × ramp × decline × (quality/100)^0.6 × market_shock
```

- `ramp` — 0.65 in a product's first round, 0.90 in its second, 1.0 after.
  New products are not yet known.
- `decline` — from age 8 onward, ×0.92 per round. Products get tired.
- `(quality/100)^0.6` — **quality grows your market, not just your margin.**
  Without this term R&D only lets you charge more for the same volume, which made
  innovation a weak lever in testing. With it, R&D compounds.
- If you stocked out last round, the pool is ×0.90. Customers who couldn't buy
  from you don't all come back.

```
demand = pool × price_multiplier
```

---

## 5. Costs

**Unit cost** falls with cumulative experience (Wright's law, ~8% per doubling):

```
unit_cost = $45 × max(0.60, (cum_units / 2000)^−0.12) × cost_shock
```

**Fixed costs:**

- Product overhead: **$40,000** per product per round.
- Capacity upkeep: **$5.00 per unit of capacity per round**, used or not.
- Corporate overhead: **$25,000 × (live products)^1.30**.

> The exponent on corporate overhead is what stops portfolio sprawl. Without it,
> launching another product was unconditionally correct at every point in the game.
> Running four lines is disproportionately harder than running one.

**Inventory:** holding costs 22% of book value per round, and stock is written
down a further 10% per round as it ages. Salvage on discontinuation is 40%.

---

## 6. Innovation — two kinds

Innovation splits into two channels that compete for the same budget.

**Product R&D — make it better.**

```
Δquality = 1.5 × √(spend / 1000) × (100 / current_quality)
```

**Process R&D — make it cheaper.**

```
Δefficiency = 1.5 × √(spend / 1000) × (100 / current_efficiency)

unit_cost multiplier    = max(0.55, 100 / efficiency)
effective capacity      = capacity × (efficiency / 100)^0.5
```

Both arrive **two rounds later**. Quality decays 4% per round; efficiency decays
2% (input costs drift, but your factory doesn't forget).

Each has the same three properties — diminishing (square root), harder as you
climb (the `100/x` term), and delayed. The difference is what they buy:

| | Product R&D | Process R&D |
|---|---|---|
| Raises | what you can charge | your margin at any price |
| Also | grows your reach (`quality^0.6`) | grows throughput (`efficiency^0.5`) |
| Substitutes for | nothing | buying more factory |

> **Process R&D needed a second job.** In the first version it only cut unit cost,
> and every pricing strategy — premium, balanced, and discount — wanted the exact
> same 20% of budget in it, even when process R&D was made four times stronger.
> That is because quality does double duty (price *and* reach) while cost reduction
> did only one. Giving process R&D a throughput effect finally separated the
> strategies.

**Even so, the split differentiates strategies only modestly.** Measured optimum
is **15% process** for a premium player and **30%** for a discount player. It is a
real decision — a discount player who puts nothing into process loses 39% of
company value — but it tilts a strategy rather than defining it. Zero total R&D
remains fatal: it returns roughly **break-even against a $940k balanced result.**

---

## 7. Capacity — cheap to build, expensive to hold

| | |
|---|---|
| Build | **$18 per unit**, arrives **next round** |
| Hold | **$5.00 per unit per round**, used or not |
| Sell | returns **$7.20 per unit** (40%), effective **immediately** |
| Floor | you cannot sell below **400 units** |

The asymmetry is the whole design. Capacity is cheap to acquire and expensive to
keep, so the mistake is not building too slowly — it's holding a factory you have
stopped filling. And because the exit only returns 40% of what you paid, escaping
costs you real money.

**This rebalance is what made capacity a decision.** Under the old numbers
($30 to build, $2.50 to hold, no exit) the gap between playing capacity well and
badly was **5%** — you could ignore the lever entirely and still play well. Now it
is **12%**.

**Selling is a genuine skill with a genuine trap.** Measured against never
selling:

| | Sell whenever capacity runs ahead of demand | Sell only once the product is in structural decline |
|---|---|---|
| 12 rounds | **−7%** | **+3%** |
| 16 rounds | −3% | **+9%** |
| 20 rounds | +4% | **+21%** |

Selling into a temporary dip costs you twice — once on the 60% you lose at sale,
again when you rebuy at full price. Selling into a real decline is one of the
strongest moves available. Same button, opposite outcomes, and telling the two
apart is the skill.

---

## 8. Cash, debt, and scoring

Start with **$250,000** (host-configurable). Losses draw on a credit line up to
**$200,000** at 5% per round. Exceed it and you're bankrupt.

**Final score:**

```
company value = cash − debt + (inventory × 0.40)
              + Σ 4 × (average profit of each live product over its last 3 rounds)
```

The multiple on recent product profit is what stops end-game asset-stripping. A
company handed over healthy is worth more than one drained to cash.

> **One accounting note for whoever builds this.** The engine charges the *full
> cost of everything produced* against the round, while per-product profit is
> recorded against *units actually sold*. So the sum of product profits does not
> equal company profit in any round where inventory changes. Both numbers are
> correct — one is cash, one is accrual — but never show them side by side as if
> they should reconcile. The practice level presents a single cash-basis P&L for
> exactly this reason, and it ties out to the penny.

---

## 9. Worked example — Round 1

Verified against the engine; the check line reconciles exactly. Note this example
predates the capacity rebalance — capacity upkeep here is the old $2.50/unit. The
shape of the round is unchanged; only that line moves.

```
Start: quality 100 | cash $250,000 | capacity 2,200 | inventory 0

PHASE A — upkeep
  quality decays 4%                                    ->    96.0
  value       = $100 × (96.0/100)                      =  $96.00
  unit cost   = $45 × (2000/2000)^-0.12                =  $45.00
  demand pool = 2000 × 0.65 ramp × (96.0/100)^0.6      = 1,268.5 units

PHASE B — decide: price $91.20 (0.95 × value), R&D $45,000, produce to forecast
  price multiplier = 1 + 2.0 × (1 − 91.20/96.00)       =  1.1000
  forecast demand  = 1,268.5 × 1.1000                  = 1,395.4 units

PHASE C — resolve
  units sold                                               1,395.4
  revenue           1,395.4 × $91.20                  $  127,260.50
  cost of goods     1,395.4 × $45.00                  $  -62,793.01
  capacity upkeep   2,200 × $2.50                     $   -5,500.00
  product overhead                                    $  -40,000.00
  R&D                                                 $  -45,000.00
  corporate overhead (1 product)                      $  -25,000.00
  ----------------------------------------------------------------
  ROUND PROFIT                                        $  -51,032.51
  cash                                                $  198,967.49

  The $45,000 of R&D buys +10.1 quality, arriving in round 3.
```

**Round 1 loses money by design.** Awareness is at 65% and the R&D just funded
won't land for two rounds. This is the single biggest trap for new players — see
§14.

---

## 10. Levels

| | Level 1 — Practice | Level 2 — Volatile | Level 3 — Shared market |
|---|---|---|---|
| Rivals | none | none | all players, one market |
| Shocks | none | full deck | full deck |
| Forecast | exact | ±15% band | ±15% band |
| Levers | unlock one per round | all open from round 1 | all open from round 1 |
| Resolves | on button press | on button press (solo) | on button press vs bots |
| Teaches | how the machine works | planning under uncertainty | reading other people |
| Status | **built** | **built** | **built** — bot rivals, advertising, and the exit/loyalty rules; networked play still needs a server |

All three levels ship as one page with the mode chosen at setup — same engine,
same code path, different inputs. Games are seeded and the seed is shown at the
end, so the same market can be replayed.

**The bots are a tier, not a stand-in.** Each level removes a different kind of
certainty: Level 1 removes none (learn the machine), Level 2 removes certainty
about the world, Level 3-with-bots removes certainty about other people *while
keeping them legible* — Valu-Line always undercuts, Meridian always charges more
and is worth it. That consistency is what lets a player learn what undercutting
actually does before facing someone unpredictable. Live play removes the last
certainty.

> **Consequence for the eventual multiplayer build: bots should fill empty seats in
> live sessions, not sit in a separate mode.** Two humans and two bots is a real
> four-company market, not a compromise — and it solves the thing that kills most
> multiplayer games, which is not having enough people online at the same moment.
> The bot policy already runs on the same information a human gets, so a seat is a
> seat either way.

**Level 3 information rules.** After each round the player sees every rival's
price, quality and market share. They never see a rival's cash, spending or plans,
and never see this round's prices before committing. The bots plan on exactly the
same basis — each estimates its own share assuming every rival repeats last
round's price. Nobody has an information advantage.

### The shock deck (Levels 2 and 3)

Three independent tracks, so a recession and a cost spike can bite at once.

| Track | Event | Effect | Rounds | Chance/round |
|---|---|---|---|---|
| Demand | Recession | ×0.70 | 3 | 20% for one demand event |
| | Consumer boom | ×1.30 | 2 | |
| | Category trend | ×1.25 | 3 | |
| | Demand slump | ×0.80 | 2 | |
| Cost | Input cost spike | ×1.35 | 2 | 16% |
| | Tariffs | ×1.20 | 3 | |
| | Commodity glut | ×0.85 | 2 | |
| Capacity | Supply crunch | ×0.65 | 2 | 12% |
| | Logistics strike | ×0.75 | 2 | |
| — | Technology leap | all quality ×0.88 | instant | 8% |

Duration matters more than magnitude. A one-round dip is absorbable; a three-round
recession while you're carrying inventory is what actually kills companies.

### Shared market (Level 3)

**Re-measured from scratch** after the capacity rebalance, the R&D split and
throughput. The previous figures were taken on constants that no longer exist.

Each firm's pull on customers — three kinds of buyer:

```
attractiveness = (value/price)^2.3          ← bargain hunters (value for money)
               × (value/avg_value)^3.2      ← quality seekers (want the best)
               × (1 + awareness/100)^0.8    ← people who have heard of you
share          = attractiveness / Σ all attractiveness
```

Total category demand still uses a much lower elasticity than share does, so a
price cut mostly steals customers rather than creating them:

```
category_demand = Σ pools × max(0, 1 + 0.8 × (1 − avg_price / avg_value))
```

**The price equilibrium moved.** `SHARE_BETA` had to rise from 2.1 to **2.3**: at
the old value, best replies pointed upward from every direction and prices drifted
without limit. At 2.3 they converge inward on **0.98× value** from both sides.
Cheaper capacity and process R&D had quietly made high pricing more attractive.

**`QUALITY_PULL` had to rise from 1.8 to 3.2 to make premium play viable.** At 1.8 a
quality-led firm lost 14-36 to a balanced one and no parameterisation rescued it.
Isolating one variable at a time showed why: *premium **pricing** was the killer,
not the premium product.* Pricing at 0.94 was even (26-24); pricing at 1.02 lost
11-39. Every other premium trait — heavier product R&D, leaner capacity, lower ad
spend — was neutral.

The fix is clean because the two constants turn out to do separate jobs.
`SHARE_BETA` governs how hard price competition bites; `QUALITY_PULL` governs what
a quality edge is worth. Raising the latter to 3.2 brought premium to 27-23 **and
left the price equilibrium pinned at 0.98 from every direction.** Past 4.0 premium
becomes dominant (33-17, then 41-9), so 3.2 is the balance point.

> A fix that was proposed and abandoned before testing: making the quality term
> absolute (`value/100`) rather than relative (`value/avg_value`). It cannot work —
> share is a *normalised* ratio, so a divisor common to every firm cancels out
> entirely. The two forms produce identical shares.

**Advertising is a share term, never a demand term** (§13 explains why). Awareness
decays **55% per round** — it is rented, not owned — and is capped at 80.

```
awareness += 8.0 × √(spend/1000)
```

`AD_GAMMA` of **0.8** was chosen as the gentlest setting that still produces a
proper prisoner's dilemma. Measured over three firms:

| Everyone spends | Each firm ends with |
|---|---|
| $0 | **$743k** |
| $20k/round | $281k |
| $40k/round | bankrupt |

Yet abstaining while rivals spend $20k costs you 62% of your value, and the best
reply is always **$10–20k — never more**. So it is individually compulsory,
collectively destructive, and self-limiting. Exactly the shape a price war has.

**Every lever stays interior in competition**, checked against a live field:

| Lever | Optimum in the shared market |
|---|---|
| Price | a band of 0.94–1.02× value; tighter with more players |
| R&D total | $60k/round — zero is bankruptcy |
| Process share | 15% |
| Capacity | 0.95× forecast — both over and under punished |
| Advertising | $10–20k/round |

**Five viable identities**, measured over 150 five-way games with shocks:

| Bot | Wins | Character |
|---|---|---|
| Premium | 32% | Highest quality, top-of-band pricing, buys little attention |
| Balanced | 31% | Middle of everything |
| Discounter | 21% | Cheap and high-volume, process-heavy R&D |
| Marketer | 9% | Average product, heavy advertising — and 17% bankruptcy |
| Operator | 7% | Lean plant, cost leadership |

**Stockouts spill.** Demand you can't fill passes to rivals with stock, so
advertising past your capacity actively funds your competitors.

---

## 11. What testing showed

Tens of thousands of simulated company-rounds. Headline results:

**Every lever has an interior optimum.** Re-measured after the capacity rebalance
and the R&D split:

| Lever | Too little | Optimum | Too much |
|---|---|---|---|
| Price | 0.80× → $707k | **0.88–0.95× value** | 1.10× → $653k |
| Production | 0.85× → $229k | **1.05× forecast** | 1.40× → $858k |
| R&D (total) | $0 → −$6k | **$45–60k/round** | $120k → $459k |
| R&D (process share) | 0% → $766k | **15–30%** | 75% → $322k |
| Capacity | 1.0× → $895k | **1.1× forecast** | 2.0× → $829k |

**No dominant strategy.** In a 360-combination sweep of price, production, R&D and
capacity policy, 74 landed within 10% of the best result — many viable paths, no
knife-edge. Best $1.11M, median $835k, worst $288k.

**Prices converge instead of spiralling.** Best replies point inward from both
directions and settle at 0.95–1.02× value. No race to the bottom, no runaway
escalation.

**Distinct identities are all playable.** Head-to-head over 60 games each, a
scale-led player beats a balanced one 32–28, and a properly-funded low-price
player beats balanced 46–14. Quality-led play is viable but currently the weakest
of the three (§12).

**Strategies that should lose, do.** A no-R&D company returns ~15% of a balanced
one and goes bankrupt in 41% of competitive games.

**The market scales.** Average company value stays in a $510k–$672k band from 2 to
8 players. Nothing breaks at either end.

**Launch timing is a real skill.** Over 16 rounds, launching a second product at
round 6 returns $1.51M and at round 8 returns $1.46M. Launching at round 1 returns
only $673k — *far worse than never launching* ($1.09M) — because it starves your
first product during its ramp. Launching at round 12 ($908k) is also worse than
never. The window is real, and it is roughly rounds 6–8 of a 16-round game.

---

## 12. Known soft spots

Honest list of what still needs work:

**Two-player games skew aggressive.** The 0.95× equilibrium holds with three or
more firms. Heads-up, undercutting is stronger, because you take share from one
opponent instead of diluting it across several. Consider a slightly lower
`QUALITY_PULL` for two-player sessions, or set a three-player minimum for
Level 3.

**Quality-led play is the weakest viable identity** — 7 wins in 100 five-way
games versus 38 for balanced. It works, but wants either a stronger `QUALITY_PULL`
or cheaper R&D at high quality to be a genuine peer. The process/product R&D split
helps a little by giving discount play its own engine, but it tilts strategies
rather than defining them (§6).

**The shared-market figures in this section predate the capacity rebalance and the
R&D split.** Price equilibrium, share allocation, and the archetype tournament were
all measured on the earlier constants. The solo numbers above have been re-measured;
Level 3 needs a re-run before those claims can be trusted again.

**Over-production is punished far more gently than under-production.** Producing
1.5× forecast costs about 6% of company value; producing 0.7× costs 88%. Directionally
right — real firms face this asymmetry — but the gap is wide enough that
"when in doubt, make extra" is close to free. If you want the quantity decision to
bite, raise the holding cost or tighten capacity.

**Bankruptcy is rare for careful players** (0–2% under the full shock deck). The
test bots throttle spending as cash falls; humans typing numbers into a box will
bust considerably more often. Worth re-checking against real playtest data before
tuning the shock deck harder.


---

## 13. Levers considered — advertising and news

Both were built and measured rather than argued about. Keeping the results here so
they don't get re-litigated.

### Advertising — tested twice, rejected both times

Two designs were built and measured against a balanced player worth **$936k**
with no advertising:

**Design A — advertising buys extra demand** (an awareness stock that decays 55%
per round). Return per dollar spent, by phase:

| Spent during | Return per $1 |
|---|---|
| The launch ramp | **−$1.51** |
| Maturity | +$0.16 |
| Decline | +$0.33 |
| Every round | −$0.30 |

Nothing clears $1. The best constant spend was a **narrow band around $10k/round**,
which is exactly the "flat tax you set once and stop thinking about" failure mode —
and above $35k/round it goes sharply negative.

**Design B — advertising accelerates a new product's awareness ramp** (pulls the
0.65 / 0.90 launch multipliers toward 1.0, does nothing afterwards). Worse:
**−$2.54 to −$4.37 per dollar** at every level tested.

It also damaged levers that already worked. With advertising on, optimal price
moved from 0.88× to 1.02× and cutting price became catastrophic (0.80× fell from
$707k to $267k), because advertising and price cuts are substitutes — once you've
bought demand, you harvest it with high prices. Optimal R&D also fell from $45k to
$30k.

### Why it fails, and when it would work

**This economy has no demand shortage that money can fix.** Demand already runs
ahead of what you can build for most of the game — that's why capacity binds and
why stockouts are the main punishment. Advertising pushes on the side of the
equation that was never the constraint. Design A's own trace shows it plainly:
demand 3,152, units sold 2,185. It bought customers the factory couldn't serve,
and stockouts then cost 10% of the following round's demand.

Worse, the launch ramp — intuitively the right moment to advertise — is precisely
when a company is most cash-poor and most capacity-constrained. That is why buying
demand there scores worst of all.

**Decision: advertising belongs in Level 3, not here.** In a shared market, buying
demand is really taking share from a rival, and the only tool currently available
for that is cutting price — which the design deliberately makes mutually
destructive. A non-price way to fight for share is a genuine gap in Level 3. It is
not a gap in solo play, where there is nobody to take share from.

**Build it as a share term, not a demand term.** That is the whole lesson of the
failed tests: adding to the demand pool pushes on a constraint that isn't binding.
Level 3 already splits share three ways, so advertising slots in as a third
channel:

```
attractiveness = (value/price)^2.1        ← bargain hunters
               × (value/avg_value)^1.8    ← quality seekers
               × (1 + awareness/100)^γ    ← people who have simply heard of you
```

That makes advertising do something none of the other levers do: move share
without touching price or waiting two rounds. It should still be *rented* —
awareness decaying fast (~55%/round) is what stops it becoming a permanent tax,
and what makes sustaining it a real cost.

Two things to respect when tuning γ. Stockouts already spill demand to rivals, so
advertising past your capacity actively **funds your competitors** — that
interaction is a feature and should be left sharp. And an advertising war has the
same prisoner's-dilemma shape as a price war: if everyone spends, shares barely
move and everyone is poorer. That is worth preserving rather than balancing away.

Tune it as part of the Level 3 rebuild, not as a bolt-on — the shared-market
figures are stale anyway (§12), so the equilibrium has to be re-measured with
advertising in the model from the start.


### News headlines — keep them, but as narration, not prediction

Headlines over the Level 2 shock deck were built and measured two ways: some
precede a real shock by two rounds, some are pure noise and look identical. The
design question was what fraction should be true.

**The answer turned out not to matter.** Value of acting on the news, over 200
games at each setting:

| Headlines true | Ignore them | Hedge | React hard |
|---|---|---|---|
| 50% | $627,725 | $648,594 | $591,512 |
| 70% | $628,093 | $642,039 | $599,881 |
| 90% | $624,644 | $637,307 | $604,759 |
| **100%** | $634,287 | **$654,696** | $625,891 |

Hedging beats ignoring by 2–3% — **and by the same 2–3% whether headlines are
coin flips or perfectly reliable.** Perfect foreknowledge of every shock, two
rounds early, is worth almost nothing. The same test on the biggest and slowest
commitment in the game — delaying a $180k product launch when a downturn is
signalled — returned +1.6% at 100% reliability and +3.0% at 50%, which is to say
noise.

**Four reasons the information has no cash value here:**

1. **The forecast already shows live shocks.** Once a recession is running, the
   player sees the smaller demand number. Advance warning only helps decisions
   with lead time, and those are the small ones.
2. **The lead-time lever is capacity**, worth 12% of outcome variance. Playing it
   slightly better at the margin is worth very little.
3. **Speculative stockpiling is priced out.** Holding costs 22% plus 10%
   obsolescence — 32% per round — against a cost spike of +35% for two rounds.
   Producing early to dodge a cost rise is almost exactly break-even. The
   inventory rules cancel the benefit precisely.
4. **Shocks are temporary and multiplicative.** They do no permanent damage that
   foreknowledge could have prevented.

**So build headlines, but point them at the present.** Narrating a shock that is
*already happening* turns an invisible number change into a legible event —
"Consumer confidence slips for a third month" instead of demand quietly dropping
30%. That is worth a great deal for comprehension and atmosphere, costs nothing to
balance, and carries no risk of teaching players to trade on information that
cannot pay. Ship the headline copy; drop the leading indicator.

**If you wanted prediction to matter**, the economy would have to change to make
it pay — cheaper inventory so stockpiling works, or a long-lead irreversible
commitment worth protecting. Both mean rebalancing levers that currently work, for
a mechanic worth 3%.

**And as with advertising, the gap is in Level 3.** News about the *economy* is
already in your forecast. News about *rivals* is not — their capacity, their
pricing, their launches are the one thing a player genuinely cannot see. A
headline that leaks a competitor's move has real value precisely because no other
part of the interface can tell you.

---

## 14. What this means for the interface

The math only works if the player can see it. Four things the UI has to do:

**Show the ramp, or players will kill healthy products.** A product's first two
rounds lose money by design. In testing, a "shut it down after two losing rounds"
rule euthanised every product in its infancy and cost 89% of company value
($1.09M down to $120k). The
product panel needs to say **"Launching — awareness 65%"**, not just show red.

**Show R&D in flight.** "$45,000 arriving round 3, +10 quality" must be visible
every round until it lands, or the player will forget they bought it and buy again.

**Show the forecast as a band, not a number.** In Levels 2–3 demand is uncertain
by ±15%. Displaying a single number teaches players to trust a figure the engine
will not honour.

**Name the binding constraint.** "You could sell 2,600 — you can only make 2,200"
is the single most actionable line the game can print.

---

## 15. Suggested host settings

| Setting | Quick | Standard | Long haul |
|---|---|---|---|
| Rounds | 8 | 12 | 20 |
| Starting cash | $300k | $250k | $200k |
| Starting products | 1 | 1 | 1 |
| Players (L3) | 3–4 | 3–6 | 4–8 |

Total rounds should always be **visible to everyone**. Knowing the game ends at
round 12 is what makes the late-game choice — milk the existing line, or gamble on
innovation that may not land in time — an actual decision.

### Difficulty dials — deliberately unused

The game is hard on purpose: every lever punishes both directions, payoffs arrive
two rounds after the commitment, and fixed costs are high enough that passivity
bleeds. That is the design, and it is staying. Recording the dials here so nobody
has to rediscover them if that decision is ever revisited.

| Dial | Current | Softer | Effect |
|---|---|---|---|
| Starting cash | $250,000 | $350,000 | Room to absorb two or three early mistakes |
| Product overhead | $40,000/round | $30,000/round | Wider margins; passivity bleeds more slowly |
| R&D delay | 2 rounds | 1 round (practice only) | Mistakes surface before they compound |
| Credit limit | $200,000 | $300,000 | Later bankruptcy, more chance to recover |

Change these in Practice mode alone if they are ever changed — Levels 2 and 3 were
balanced against the current values, and every measured figure in this document
assumes them.

**Two things worth separating: hard and opaque.** The difficulty is intentional.
The opacity is not, and it is the cheaper thing to fix if the game ever needs to
feel more welcoming:

- **No sense of scale.** Every slider starts at zero with no indication of what a
  normal value looks like, so a new player cannot tell whether R&D means $5,000 or
  $500,000. A quiet "most players spend $45–60k here" under each lever would remove
  the guesswork without removing the decision.
- **No positive signal.** The interface warns about stockouts and unsold stock but
  never says a round went well. That absence makes the game read as harder than it
  actually is — a player doing fine has no way to know it.

---

## 16. Live sessions — design notes for the multiplayer build

Not built. This is the spec as it stands, recorded so the decisions already made
don't have to be re-argued.

### Hosting

A player starts a session and sets its rules. Others join. Bots fill any seat that
stays empty (§10).

| Setting | Expose how | Why |
|---|---|---|
| Number of players | **3–6, default 4** | See below — measured, not guessed |
| Number of rounds | Free, 8–20 | Visible to everyone — it's what makes the endgame a decision |
| Starting cash | **Preset or bounded** | A difficulty dial, not a preference |
| Bankruptcy threshold | **Preset or bounded** | Same |

> **Starting cash and the credit limit are the two constants the whole economy was
> balanced against.** A host who sets starting cash to $50,000 produces a game
> where no strategy works, and the people who suffer are the players who joined,
> not the host who chose it. Offer named presets — Standard, Forgiving, Brutal —
> with custom values clamped to a sane band. Never a free text box.

### How many players

**Minimum 3, sweet spot 4–5, cap at 6.**

Measured how much a player's own choices move their own outcome, 100 seeds per
point:

| Players | Pricing | R&D | Advertising | Bankruptcies per game |
|---|---|---|---|---|
| 2 | 40% | 108% | 104% | 0.25 |
| 3 | 29% | 127% | 136% | 0.15 |
| 4 | 16% | 122% | 107% | 0.30 |
| 5 | 17% | 125% | 129% | 0.45 |
| 6 | 11% | 125% | 122% | 0.65 |
| 8 | 27%* | 134% | 122% | **1.02** |

**Player count erodes *pricing* power specifically, not agency overall.** Price acts
relative to the field, and one firm's weight in the field average shrinks as the
field grows. R&D and advertising act on your own product and your own awareness —
absolute effects — so they stay decisive at every size. Nobody becomes a passenger;
they just stop being able to move the market on price alone.
(*The 8-player pricing figure is inflated by frequent bankruptcies, where price
affects survival rather than share.)

So the cap is about **carnage and legibility, not agency**. At eight players a
company dies every game on average, the winner-to-loser gap reaches 6.7×, and a
player reads eight rival cards while everyone waits on the slowest person. Being
eliminated in round 7 and watching is not a game.

**Why not 2:** it works, and it gives the most pricing power, but it is a duel
rather than a market — no third party to absorb a price war, and heads-up play
skews aggressive because undercutting takes share from exactly one opponent (§12).
Three is where structure appears: someone can go premium while another goes cheap.

**Why 4–5 is best:** winner diversity peaks at five, where all five archetypes win
games. At three the field is too small for that variety.

> Measured against bots, which are consistent. A field of humans will be swingier,
> and the likely effect is to push the comfortable maximum *down*, not up. Worth
> re-checking against real sessions before raising the cap.

### Standing orders — the mechanic that decides whether this works

Every turn-based multiplayer game lives or dies on what happens when somebody
doesn't submit. The answer:

- **If you don't submit, last round's orders repeat.** It keeps the game moving, it
  is realistic (a company making no new decisions carries on as before), and it
  lets a new player set something sensible and let a few rounds ride.
- **A round resolves when everyone has submitted, or when the host's clock runs
  out — whichever comes first.** A timer alone punishes fast players; waiting for
  everyone alone lets one absent person freeze the game.

### Hidden bots

**Sessions seat five. Empty seats are filled by bots, and players are not told
which companies are which until the game ends.**

An opponent you are unsure about is worth studying in a way a labelled bot never
is — and it makes the empty-lobby problem disappear rather than merely solving it.
Three requirements:

**1. The bots have to stop being obviously mechanical.** Built and measured — see
*Making the bots pass* below.

**2. Presentation splits by tier.** Built — see *Labelled and hidden* below.

**3. Disclose the presence, never the identity.** The lobby should say plainly that
empty seats are filled by AI companies and that nobody learns which until the end.
That keeps the whole mystery intact while removing any chance a player feels
cheated when the reveal lands. It costs nothing.

**The end-of-game reveal** shows final standings and, alongside each company,
whether it was a person or a bot. That is the payoff — and "I was sure Kestrel was
a human" is the moment worth designing for.

> **Open question: what an eliminated player does.** At five players roughly half of
> games see someone go bankrupt (§16, 0.45 per game). A bot going under is fine. A
> human knocked out in round 7 is a spectator for the rest of the session. Decide
> whether they keep a seat at the table — even just to watch and see the reveal —
> or get some other role.

### Making the bots pass — built and measured

The bots were fixed parameter sets: Valu-Line priced at exactly 0.92× value every
round, spent the same money every round, never overreacted, never erred. The
assumption going in was that the giveaway would be a *frozen price*. It was not.

**Fixed bots already moved their price — $3.78 a round on average**, because price
is derived from value and value climbs as R&D lands. A player watching the price
column would have seen it drifting upward the whole game and concluded nothing.

**The actual tell was the decimals.** A ratio times a value produces $88.32,
$84.79, $90.19 — numbers no human types. Over a measured run, fixed bots produced
**0% whole-dollar prices**. People price at $95, $100, occasionally $107.50.

Four behaviours were added, each removing one tell without changing what the
personality *is*:

| Tell | Behaviour added |
|---|---|
| Prices with cents | Snap to $5 (30%), whole dollars (50%), half-dollars (20%) |
| Position never moves | Mean-reverting drift on the price ratio, ±0.07 max, ×0.84 decay |
| Never reacts | Share below 14% shades price down; above 34% takes margin; a stockout raises price |
| Never errs | 9% chance a round, 3-round cooldown: over-order 1.35×, skip R&D entirely, panic-buy ads 2.2×, overbuild the factory 1.45× |

Spending is also jittered (±14% R&D, ±18% ads, ±5% production, ±4% capacity
headroom) and snapped to round figures — $40,000, not $40,600.

**Measured in the built game**, four rivals over a full run:

```
Valu-Line     $90.00  $85.00  $91.00  $95.00  $105.00 $107.00 $111.00 $114.50 $117.00
Meridian      $100.00 $95.00  $100.00 $112.00 $115.50 $121.00 $127.50 $134.00 $140.00
Brightwell    $95.00  $90.00  $97.00  $103.00 $108.00 $115.00 $116.50 $120.00 $125.00
Kestrel Works $95.00  $90.00  $95.00  $100.00 $107.00 $110.00 $113.00 $114.00 $117.00
```

89% whole-dollar prices, mean move $4.97, zero identical repeats. That reads as
four people making judgement calls.

**Balance survived.** 200 games each, five personalities, before and after:

| | Discounter | Premium | Marketer | Operator | Balanced | Bankruptcies/game |
|---|---|---|---|---|---|---|
| Fixed | 33.5% | 28.0% | 4.0% | 13.0% | 21.5% | 0.45 |
| Humanised | 30.5% | 33.0% | 9.5% | 10.0% | 17.0% | 0.60 |

The spread narrowed slightly — noise costs the sharpest strategies a little and
gives the weakest one (Marketer, 4% → 9.5%) room. Bankruptcies rose from 0.45 to
0.60 a game, which is the mistakes doing their job. No personality became
dominant or non-viable.

**One caveat.** The humanisation layer uses a seeded PRNG per bot and is *not*
covered by the Python↔JavaScript parity test — only the core economy is, and that
is unchanged (verified again after the port: max divergence 1e-06, which is the
6-decimal rounding in the test harness). Bot behaviour is reproducible within a
seed but is not cross-language identical, which is fine because bots are decided
client-side in solo play and would be decided server-side in a live session.

### Labelled and hidden — built

Humanising behaviour removes the tells a player could *measure*. It does nothing
about the ones they can simply *read*. "Valu-Line — cheap and everywhere" is not a
clue, it is a confession, and no amount of price jitter survives it.

So presentation is now a choice at setup, on Level 3 only:

| | Labelled | Hidden |
|---|---|---|
| Names | Valu-Line, Meridian, Brightwell… | Drawn from a 25-name pool in the style players pick from |
| Tagline | Shown | Absent |
| Which personalities | First *n*, always the same order | Shuffled from the seed |
| Seat order | Fixed | Shuffled |
| Reveal | — | Final standings name each strategy |

Shuffling matters as much as the names do. If hidden mode had kept `BOTS.slice(0, n)`,
a player who ran one labelled game would know seat 1 is always the discounter, and
the whole disguise would come off in a single round.

**Verified by sweeping the rendered page**, every round, for all five bot names,
all five taglines and the blurb text: **zero leaks in hidden mode**, all present in
labelled mode. The coach line that names a rival who is undercutting you now uses
the display label, so it works in both.

**Final standings were missing entirely** and are now built — every company ranked
by value, your own row highlighted, and in a hidden game a strategy label against
each rival: *"Premium — charge more, out-innovate"*. That table is the payoff, and
it did not exist before this pass.

Labelled stays the default. It is the better teacher, and the point of the
practice tier is to make the five strategies legible before anyone has to identify
one blind. Hidden is the rehearsal for live play.

**Still open for live sessions:** in a real session the reveal has to say *person or
AI*, not just which strategy — the seat model is there, but there are no human
seats to mark yet.

### Persistent identity

Players create a company name once and keep it across games. Because it is stable,
it is free to carry a record: games played, best company value, win rate, and which
identity they tend to play. A light progression system that costs almost nothing.

This implies the profile lives server-side rather than on the device, so it
survives switching machines. And if sessions are joinable by strangers, names need
basic filtering and a uniqueness rule — cheap up front, awkward to retrofit.

### What still has to be decided

- **Synchronous or asynchronous.** A twenty-minute game in one sitting and a game
  where a round resolves once a day are both viable, but they want different round
  timers, different notification behaviour, and possibly different round counts.
- **What players see about each other mid-game.** Level 3's rule against bots —
  prices, quality and share revealed only after a round — should carry over
  unchanged. It is what makes committing blind meaningful.

---

## 17. Buyouts — tested, and why the obvious version does not work

The proposal: a player heading for bankruptcy can be bought out by a rival.
Built into the simulator and measured over 400 paired games (same seeds,
acquisitions on and off).

### The snowball fear was unfounded — it runs the other way

| | With buyouts | Without |
|---|---|---|
| Winner's margin over 2nd place | **56%** | 63% |
| Round-6 leader goes on to win | **46%** | 51% |

Buyouts *compress* the field and make an early lead slightly **less** decisive.
There is no runaway.

### The real problem: nobody would ever buy

| Variant | Deals | Buyer better off | Median change to buyer |
|---|---|---|---|
| Run the acquired line | 90 | **7%** | −$212,950 |
| Shut it down for scrap | 106 | 12% | −$130,468 |
| Shut it down, earlier trigger | 139 | 12% | −$110,154 |
| Only before round 8 | **0** | — | — |

Buying a distressed rival made the buyer worse off **88–93% of the time**.

Three findings behind that:

**Distress never happens early.** Restricting deals to before round 8 produced
*zero* deals in 400 games. Companies here survive comfortably and then fail late —
so an acquisition always lands with no runway left to fix anything.

**Corporate overhead is not the culprit.** The obvious fix was synergy — let an
acquired line be absorbed rather than run as a separate business. Removing the
overhead escalation *entirely* moved the buyer's success rate from 7% to 6%, and
at high synergy more buyers went bankrupt, not fewer.

**What you are actually buying is an ongoing loss plus its debt.** A distressed
company is losing money every round; that does not stop when it changes hands. Its
recoverable assets are worth ~$25k against ~$70k of debt. No structural relief on
the buyer's side fixes an asset that is underwater by construction.

### The version that would work

Make it **the seller's decision, not the buyer's.** A company heading for
bankruptcy can accept a buyout at a formula price and exit with that as its final
score — from the market, not from a rival who has to want it.

That keeps everything the idea was for:

- a failing player exits with a number instead of a seat to watch from
- "sold the company" becomes a legitimate ending rather than a loss
- and it creates a genuinely hard decision for the seller — **take the offer now,
  or spend two more rounds trying to recover and risk getting nothing** — which is
  exactly the kind of choice the rest of the game is made of

What it drops is the part the measurements say cannot work: requiring a rival to
find a distressed company attractive. They never will, and they are right not to.

### Two tracks: the market buys companies, players buy assets

**Sell to the market (a bot buyer) — always available.** Formula price, debt
cleared, the seller exits with that as their final score. This track has to exist
precisely because the measurements say a rival will almost never want a distressed
company. The exit cannot depend on someone else's appetite.

**Sell to a player — available when someone genuinely wants it.** Rare by design.
A dramatic option should be rare.

What changes hands differs by track, and that is the important part:

| | Sold to the market | Sold to a player |
|---|---|---|
| What transfers | the whole company | assets: capacity, stock, or a product line |
| The debt | cleared from proceeds | **stays with the seller** |
| Seller afterwards | out, holding the payment | still playing, holding cash and their debt |

**There is already a bargaining range in the economy, and it was not put there on
purpose.** Capacity costs **$18** to build and returns **$7.20** as scrap. Any
price between those makes both sides better off — the seller beats scrapping, the
buyer beats building. About $10.80 per unit of genuine surplus to divide, arising
directly from the build/scrap asymmetry that makes overbuilding punishing (§7).

**A product line is the bigger prize.** Quality, efficiency, awareness and
cumulative volume have no scrap value at all. A buyer picking up a product at
quality 130 acquires something that would have cost them roughly $200k and six
rounds of R&D to build. That is where a player-to-player deal is genuinely worth
doing — and it leaves the seller holding their debt and an empty shell, which is a
desperate and interesting move if they have a second line to survive on, and simply
the end if they do not.

> **Untested, and it matters:** distress never arrives before round 8 (measured
> above), so by the time a sale is obvious there is rarely runway left for a buyer
> to profit. If player-to-player deals are meant to actually happen, they probably
> need to be open to *healthy* companies too — a voluntary sale rather than a
> distressed one. That is a different mechanic and should be measured on its own
> before it is built.

### Player-to-player deals — and how they differ from Monopoly

Offers can run in both directions: post an asking price for one of your own lines,
or bid unsolicited for someone else's. Whole companies go to the market (above);
players trade lines and assets.

**The structural question is whether an asset is worth different amounts to
different buyers.** If everyone values it identically, trading is haggling over a
known number — Monopoly. Measured by handing the same product line, free, to each
of three rivals at mid-game across 101 games:

| Buyer | Median gain | Positive in |
|---|---|---|
| Premium | +$8,202 | 54% of games |
| Balanced | +$9,547 | 51% |
| Operator | +$13,006 | 56% |
| **Spread between best and worst buyer** | **$62,481** | — |

The medians are nearly identical across archetypes while the spread is large, which
means **value is situational, not typological.** There is no rule to learn like
"operators always want lines" — it depends on your capacity position, your quality
gap, how many rounds are left and what the market is doing. A bid is a judgment
call made under uncertainty, and roughly half of them would be wrong.

**Three rules do the anti-Monopoly work:**

1. **Sealed bids, resolved with the round.** Offers are submitted alongside normal
   orders and settle when the round settles. No separate negotiation phase, so the
   game cannot stall — the failure mode that actually ruins Monopoly — and it works
   asynchronously.
2. **Accept or decline, but never accept a lower bid.** A seller may refuse
   everything; if they accept, it is the highest offer. This is what kills
   kingmaking: a company cannot be handed to a friend cheaply, or dumped to spite
   the leader.
3. **A price floor at computed asset value**, so a sale cannot be used to move money
   around under cover of a trade.

Combined with incomplete information — nobody sees a rival's cash or unit costs —
bidding is closer to poker than to property trading: you are guessing what the line
is worth to *them* as well as to you.

> **Expect this to be rare.** Even given away free, a product line was worth having
> only about half the time. Once a buyer is paying, most bids should be low and most
> deals should not happen. That is the right shape for a dramatic option, but it
> should not be built expecting heavy use.

### Voluntary sales of healthy companies — they work, but the timing is degenerate

Unlike distressed sales, a healthy line *is* worth buying. Measured across 14-round
games by comparing what a buyer would gain against what the seller gives up by
leaving:

| Sale round | Buyer's max willingness to pay | Seller gives up | Deal possible |
|---|---|---|---|
| 3 | $5,478 | $126,162 | 11% |
| 5 | $59,373 | $132,079 | 19% |
| 7 | $77,035 | $68,605 | **41%** |
| 9 | $55,532 | $17,300 | **63%** |
| 11 | $169,836 | $39,893 | **88%** |

**Both sides want to trade late, and that is the problem.** The seller's
reservation price falls as the game shortens — fewer rounds of profit left to give
up — while the buyer's willingness to pay *rises*. Left alone, every deal in the
game would happen in the last two or three rounds, which is precisely when an
acquisition has no time to matter strategically. It becomes a score transfer, not a
decision.

**The cause is mostly structural, not a scoring bug.** My first guess was the
terminal multiple (4× recent profit) transferring with the asset, so I tested a
holding period. It barely helped: requiring three rounds of ownership changed
nothing at all, and requiring four only cut the round-11 figure from $168,738 to
$92,173 — still the highest of any round. The dominant effect is simpler: **an
acquired line carries ongoing corporate overhead, and buying late means paying it
for fewer rounds while receiving the same asset at scoring.** Buying at round 5
costs about nine rounds of escalated overhead; buying at round 11 costs three.

**The fix is a deadline, not a holding period: no deals in the final third of the
game.** That removes the degenerate endgame entirely and leaves a genuine window —
roughly rounds 4 to 9 of 14 — where a deal is viable 20–60% of the time and has to
actually play out. A trade becomes a bet on the rest of the game rather than a
purchase of someone else's final score.

> This is the only trading mechanic of the three tested that produces real deals at
> a strategically interesting moment. Distressed rival-to-rival sales never pay
> (§17); late voluntary sales pay for the wrong reason. **A bounded window on
> voluntary sales of healthy lines is the one worth building.**

### When a firm exits, the market barely moves

Measured by removing a healthy firm at round 7 and comparing survivors against the
same game where it stayed:

| Survivor's… | Change |
|---|---|
| Market share | **+9.0 percentage points** |
| Demand per round | +15 units |
| Final company value | **+$6,825** |

Share concentrates and the pie shrinks by almost exactly the same amount, because
each firm contributes its own demand pool (§10). The two cancel.

**Consequence: driving a rival out of business gains you nothing.** There is no
predatory pricing, no war of attrition, no reason to push a wounded competitor over
the edge. That is defensible — a category with more players genuinely is bigger,
since they collectively create awareness and variety — but it is a choice, not an
accident, and it should be made deliberately.

> **The lever, if elimination should pay:** make the category pool scale
> sublinearly with the number of firms — `MARKET_BASE × n^0.7` rather than
> `MARKET_BASE × n`. Then losing a firm shrinks the pie less than it concentrates
> share, and survivors genuinely gain. One constant. It would make the game meaner
> and invite pile-ons; measure before adopting.

### The actual trading window is narrower than "not the final third"

Setting the buyer's willingness to pay against what the seller gives up by leaving:

| Round | Buyer offers up to | Seller requires | Zone of agreement |
|---|---|---|---|
| 3 | $5,478 | $94,080 | none |
| 5 | $59,373 | $79,595 | **none** |
| 7 | $77,035 | $54,003 | **$23,000** |
| 9 | $55,532 | $32,874 | **$22,000** |
| 11 | $169,836 | ~$40,000 | large, but degenerate (§17) |

**The real window in a 14-round game is roughly rounds 7 to 9 — about the 50–65%
mark.** Before it, sellers rationally refuse; after it, deals become endgame score
transfers. Bound the mechanic to that band rather than merely excluding the final
third.

**Selling out and coasting is a legitimate, sensibly-priced strategy.** The cost of
leaving declines steadily and predictably as the game shortens, so a player who
sells is making a real judgement about their prospects rather than exploiting a
loophole. Their score locks at the sale price and they can watch the rest.

### The new entrant — and the one constant that blocks it

Proposal: a company offered for sale that nobody buys goes to a bot, and an
aggressive new technology company enters in its place. Tested at round 7 of 14.

**A newcomer is a gift to the survivors, not a threat.** Entering at baseline
quality it finishes on −$83,212 while survivors gain 72–83%. It arrives at quality
100 against incumbents at 130+, sits in the awareness ramp, and funds R&D that
cannot land in time — while contributing a full demand pool to a market it cannot
compete for.

Giving it a genuine technology advantage was the obvious fix, and it does not work
either:

| Entrant quality | Wins the game | Effect on survivors |
|---|---|---|
| 0.95× market | 4% | **+73%** |
| 1.05× market | **26%** (a fair share of wins) | **+42%** |
| 1.10× market | 53% | +23% |
| 1.25× market | 100% | −3% |
| 1.30× market | 100% | −8% |

**At a fair win rate the entrant is still a 42% windfall for everyone else, and to
stop being a windfall it has to win essentially every game.** There is no setting
in between.

### Both problems are the same problem

An exit barely moves the market, and an entrant is a gift, for one shared reason:
**each firm contributes its own demand pool**, so the category grows and shrinks
with the number of competitors. Adding a handicapped firm expands the pie by more
than its slice; removing one shrinks it by as much as it concentrates.

> **The single fix: scale the category pool sublinearly with firm count.**
> `MARKET_BASE × n^0.7` rather than `MARKET_BASE × n`.
>
> - An exit then shrinks the pie **less** than it concentrates share → eliminating a
>   rival pays, and predatory play becomes a real strategy
> - An entrant then grows the pie **less** than it takes share → a newcomer is a
>   genuine threat at a fair strength
>
> One constant corrects both. **It is load-bearing and should be tested before
> either mechanic is built** — every balance figure in §10 assumes the current
> linear pool, so the whole shared market would need re-measuring afterwards.

### The n^0.7 pool — tested, and rejected

Scaling the category pool sublinearly with firm count was the proposed single fix
for both the inert-exit and gift-entrant problems. Built and measured.

**It does what it was meant to do.** Eliminating a rival went from worth **+2%** to
worth **+36%** to the survivors. Predatory play becomes a real strategy.

**It did not fix the entrant**, because that was never the same problem. A
replacement keeps the field at the same size, so pool scaling never engages. A weak
newcomer is good for its rivals and a strong one is bad for them; there is no
neutral setting, and there was never going to be. *(The right comparison for an
entrant is not "the rival stayed" but "the seat sat empty" — and against that
benchmark a newcomer at 1.05× market quality is close to neutral while still
winning a fair 25% of games. That version is fine and needs no structural change.)*

**And it broke the shared market.** Re-tuning `SHARE_BETA` from 2.3 to 2.9 restored
a convergent price equilibrium, but everything downstream came apart:

| | Before | After |
|---|---|---|
| Best price | interior at 0.98 | **0.88 — bottom of range, no interior optimum** |
| Best capacity | 0.95× forecast | **1.35× — pushed to the top** |
| Best advertising | $10–20k | **$0 — the lever is dead** |
| Discounter win rate | 21% | **72%** |
| Premium / Marketer | 32% / 9% | **4% / 0%**, with 25 and 28 bankruptcies |

Five viable identities collapsed to one.

**The bias is structural, not mis-tuned.** A smaller pie per firm makes taking share
from rivals matter more than growing the category — which mechanically rewards
undercutting. Another tuning cycle might claw some of it back, but it would be
fighting the change rather than fixing it.

> **Verdict: not adopted. Reverted to the linear pool.** The goal was "exits should
> matter," and that does not require restructuring how the market scales. A targeted
> alternative worth testing instead: when a firm leaves, redistribute its recent
> share to the survivors as a **one-off transition**, decaying over two or three
> rounds. That makes an exit felt without touching the equilibrium, the lever
> optima, or the archetype balance — all of which the structural version destroys.

### What actually works: a one-round offer, then the customers are shared out

The proposal — a sale is offered for a single round; if no player takes it, the
company leaves and its customers distribute to everyone still playing. Built and
measured.

**It makes a departure matter, at the right size.**

| | Survivors gain |
|---|---|
| Current model (customers simply vanish) | +2% |
| Customers inherited permanently | **+178%** — a runaway |
| **Customers inherited, fading 30% per round** | **+23%** |

Permanent inheritance is far too strong. A **30% decay** leaves an exit clearly
felt without handing the game to whoever was nearest.

**And unlike the `n^0.7` pool, it costs nothing elsewhere.** Run across 250 games
on both builds, the inheritance version was **identical in all 250** — because
`inherited` stays at zero until an exit occurs, so the demand calculation is
unchanged in every game where nobody leaves. Archetype win rates confirm it:
32/28/24/10/5 with inheritance against 33/28/24/10/5 without, and the winner's
margin moved from 100% to 97%.

**No re-tuning required.** The equilibrium, the lever optima and the bot balance
were all measured in games without exits, and those games are bit-identical.

> **Built and shipped.** The exit rules are live in Level 3: a failed rival's
> customers redistribute by price similarity, only 65% of them move, and the
> advantage fades 30% a round. The player is told what they inherited and why.
>
> **This is the version to build.** It delivers what the structural change was
> meant to deliver — a departure that the survivors actually feel — while touching
> nothing that was already tuned. The difference is that it fires on an *event*
> rather than altering the standing shape of the market.

**Mechanic as specified:**

1. A company puts itself up for sale. The offer stands for **one round**.
2. Any rival may bid (sealed; highest bid wins; a floor prevents nominal transfers).
3. If a bid is accepted, the line transfers and the seller exits with the payment.
4. If nobody bids, the company leaves anyway — the seller takes the market's
   formula price, and its customers are shared among the survivors in proportion to
   their size, fading 30% per round thereafter.

The one-round window is what keeps it moving: no haggling across rounds, no
stalling, and the seller knows before offering that they are leaving either way.

### The market and a rival are not the same buyer — and the price must reflect that

Measured from one surviving player's point of view when a rival leaves at round 7:

| What happens | That player's final value | |
|---|---|---|
| Nobody bids; the market takes it | $320,960 | baseline |
| **They buy the line themselves** | **$143,978** | **−55%** |
| **A different rival buys it** | **$405,984** | **+26%** |

**At the price the formula was setting, buying is a trap and the best available
outcome is watching a rival fall into it.** A buyer pays cash, takes on escalated
corporate overhead, and is weakened by the purchase — which is worth more to
everyone else than the customer windfall they forgo.

Taken at face value that kills the mechanic: nobody would ever bid. But the cause
is the pricing formula, not the design. **The market was offering $170,316 while a
rival's genuine willingness to pay at that round is $77,035** (§17). Setting the
market price at assets *plus four times recent profit* makes the market the highest
bidder by construction, so every seller takes it and no rival ever competes.

**The market must be a floor, not a competitor:**

| Buyer | Price | What it means |
|---|---|---|
| The market (bot) | **assets only, ≈$20k** | Low, guaranteed, always available |
| A rival | negotiated, **$54–77k** | Above the floor, below their own valuation |

That separation makes the two paths mean different things:

- **A healthy company only ever sells to a rival.** The floor is far below what
  continuing is worth to it ($54k at round 7), so absent a real bid it simply keeps
  playing. No forced exit.
- **A distressed company takes the floor**, because $20k beats a continuation worth
  less than nothing.
- **Customer redistribution therefore fires on failure, not on trade** — which is
  the right place for it. A company that sold to a rival is still being served by
  that line; a company that folded is not.

> The general lesson, worth remembering for any auction added later: **if the
> guaranteed outside option is priced above what bidders would pay, bidding becomes
> a curse and the auction never happens.** The floor has to sit below the lowest
> genuine valuation, not above the highest.

### Grounding the exit rules in what actually happens

The redistribution rate had been tuned by feel. Checked against the empirical
record, and the evidence changes two things.

**Not all of a dead company's customers find a new home.** When Spirit Airlines
liquidated in May 2026 it took **1.8 million seats off the May calendar overnight**,
and Frontier — the main carrier picking up its routes — could not backfill
**60,000 daily passengers**. Capacity constrains absorption; stranded demand simply
goes unserved. The retail evidence points the same way: a warehouse-club study
found only **30%** of a closed store's sales transferred to nearby locations, and a
large mass-merchandiser study found competitors gained **negligibly** when a rival
closed — most spending either moved within the same chain or stopped.

> **Change made: `INHERIT_SHARE = 0.65`.** Only about two-thirds of a departed
> firm's demand redistributes; the rest evaporates. That moves the survivors' gain
> from +23% to **+15%**, and it encodes something true — *a market shrinks when a
> company dies.*

**The advantage fades, and the timescale matches.** The mass-merchandiser study
tracked spending elevated in months 2–5 after a closure and back to baseline by
months 6–11. At a round per quarter, `INHERIT_DECAY = 0.30` leaves roughly 70% of
the advantage gone after four rounds — the same shape.

**Survivors also gain pricing power, which the model already produces.** After
Spirit's exit, fares rose **15–25% on every route where it had held double-digit
share**, with individual routes spiking far higher — LAS–DFW went from $39 to $124
in 48 hours. Delta, American and United quietly dropped the aggressive Basic
Economy pricing they had only been running to match Spirit. In the game this
emerges without a special rule: one fewer competitor in the share denominator means
less price pressure on everyone left.

**And the capacity constraint is already modelled correctly.** Demand a survivor
cannot supply spills to whoever can (§10) — which is precisely the Frontier
situation, where the demand existed but the seats did not.

Sources: [Impact of Competitor Store Closures on a Major Retailer](https://journals.sagepub.com/doi/10.1111/poms.13574) ·
[How Consumers Respond to Retail Store Closures (MSI)](https://thearf-org-unified-admin.s3.amazonaws.com/MSI_Report_23-135.pdf) ·
[Airfares after the Spirit liquidation](https://247wallst.com/investing/2026/05/07/airfares-skyrocket-as-much-as-218-on-spirit-airlines-busiest-routes-within-just-48-hours-of-its-may-2-liquidation/)

### Loyalty: orphaned customers go to the closest substitute, not the biggest survivor

The redistribution was weighting by size. The evidence says that is wrong.

**When Spirit Airlines failed, every carrier that absorbed its routes was a
low-cost carrier** — JetBlue (11 destinations out of Fort Lauderdale), Breeze
(Atlantic City, where Spirit had held ~75% of traffic), Frontier (13 former Spirit
routes) and Allegiant. **None of it went to Delta, American or United**, who had
far more capacity and were sitting on the same routes. JetBlue went further and ran
a **status match for Spirit's loyalty members** — actively courting the orphaned
base rather than waiting for it.

The academic work says the same thing in general terms. Research on brand
"afterlife" finds consumers **retain loyalty to a brand after it dies and channel
that attachment toward substitutes**, with which competitor captures them varying
by local conditions — they go somewhere specific, not everywhere evenly. The
retail study likewise found the customers most likely to follow were the *most
frequent* ones, not the most casual.

> **Change made: redistribution is now weighted by price-position similarity, at
> `INHERIT_AFFINITY = 12.0`.** Calibrated against the Spirit outcome — when a
> budget firm fails, the nearest-priced survivor takes **71%** of its orphaned
> customers and the premium player takes **6%**:
>
> | Affinity | Budget rival | Mid-market | Premium |
> |---|---|---|---|
> | 0 (by size) | 33% | 33% | 33% |
> | 4 | 47% | 32% | 21% |
> | **12** | **71%** | **22%** | **6%** |
> | 16 | 80% | 17% | 3% |

**What this adds to the game:** positioning near a weak rival becomes a bet on
inheriting their customers when they fold. A premium player watching a discounter
die gains almost nothing; the other discounter gains a great deal. That is a real
strategic consideration nobody designed in — it falls straight out of matching the
evidence.

> Measured honestly: at the weaker setting the effect on final outcomes was
> invisible (a $30 difference on $45,000 of gains). At 12.0 the split is decisive,
> but the *outcome* effect is still modest because only 65% of one firm's demand is
> in play and it decays 30% a round. It shapes **who** benefits far more than **how
> much** — which is the right emphasis, and matches the airline case where the
> question was never whether traffic moved but which carriers got it.

Sources: [US carriers move to fill Spirit routes](https://www.aerotime.aero/articles/us-low-cost-carriers-fill-spirit-routes-shutdown) ·
[Brand afterlife: transference to alternate brands following corporate failure](https://experts.arizona.edu/en/publications/brand-afterlife-transference-to-alternate-brands-following-corpor/) ·
[How Consumers Respond to Retail Store Closures (MSI)](https://thearf-org-unified-admin.s3.amazonaws.com/MSI_Report_23-135.pdf)


---

## 18. Live sessions — built

§16 was the design. This is what was built, and the four things that turned out
differently once it was running.

### Shape

A host creates a game, gets a six-character code and a share link, and sends it to
friends. Empty seats fill with hidden bots at kick-off. **One round a day**: a
round closes when everyone still playing has filed, or when the host's clock runs
out — whichever comes first.

No accounts. Naming your company gets you a token in your browser, and that token
is you. It is the right trade for a game you play with people you already know,
and the one real failure mode — clearing your browser data mid-game — is worth
naming rather than engineering around.

| Piece | What it does |
|---|---|
| `lib/engine.mjs` | Generated from `engine.js`, so the server runs byte-identical economy code to the browser |
| `lib/game.mjs` | Every rule. Pure functions, injected clock, no network |
| `netlify/functions/api.mjs` | create · join · start · submit · state |
| `netlify/functions/tick.mjs` | Hourly sweep for rounds nobody opened |
| Netlify Blobs | One JSON object per game. A finished 5-company season is ~48 KB |

**Rounds mostly close without the schedule.** Any request that touches a game
first asks whether its clock has run out, so the next player to open the page
triggers the round. The hourly function is the backstop for a game everyone has
forgotten, not the mechanism. That removes the usual async-game failure where the
scheduler is the only thing that can advance play.

**The clock is injected everywhere**, which is why a twelve-day game can be tested
in twelve milliseconds. `test/season.mjs` plays a full season — three humans, two
bots, one player who files every round, one who forgets twice, one who vanishes
after round two — and asserts on standing orders, bankruptcy, redistribution and
the reveal.

### What testing changed

**1. The shock generator could not be saved.** `newShockState` returned a closure.
In the solo game that is fine — it never leaves the tab. On a server the game is
written to storage between every single request, and `JSON.stringify` silently
drops functions, so the first player to load a saved game would have crashed the
round. Shock state is now a seed and a call count that rebuilds the stream.

**2. A technology leap only hit one company.** `shockTick(S, firm)` applied the
quality hit to whichever single firm was passed. In the solo game that was always
*the player* — so the bots were quietly immune to the one shock that hurts most.
In a live game it would have been one randomly chosen company. It now takes a list
and hits everyone. **This was a bug in the shipped solo game too, found only
because the server forced the question of which firm to pass.**

**3. The host's settings were being thrown away.** The client read the seat count,
round count and difficulty *inside* the async handler — after the busy-state
re-render had rebuilt the form and reset every button. Every game was created with
defaults no matter what the host picked. Two other handlers had the same shape.
Found by a two-browser test that asserted the lobby showed what was chosen.

**4. The invitation link had no way to accept it.** Opening a share link showed the
lobby, the seat list and the game settings, and no join form — because the join
form lived on the home screen. The single most common way anyone reaches this
product was a dead end. Also found only by driving a real browser.

### How many seats, and how long — measured

24 seasons per cell, all seats playing competent policies (`test/seats.mjs`):

| Seats | 8 rounds, median company | 12 rounds, median | Bankruptcies at 12 |
|---|---|---|---|
| 3 | $276k | $157k | 0.13 |
| 4 | $288k | $196k | 0.17 |
| 5 | $276k | $177k | 0.25 |
| 6 | $284k | $193k | 0.38 |

**Seat count barely matters** — each seat brings its own customers as well as its
own $65k of fixed cost, so the market grows with the table. §16's 3–6 holds, and
for a better reason than the one originally given.

**Length matters enormously, and it exposed a real gap.** From $250k of starting
cash, an 8-round game ends around $280k and a 12-round game around $180k. The
difference is the product decline that begins at round 8 — and in the solo levels
the answer to a maturing product is to *launch a new one*. **Live sessions give
each company one product and no launch button**, so a long game has no answer to
its own decline. Rather than ship a default that grinds everyone down, the range
is 8–14 rounds, default 10.

### The honest limitations

- **One product per company.** The launch lever exists in the solo game and not
  here. It is the single biggest gap, and it is what would make 20-round seasons
  work. Everything needed for it is already in the engine.
- **Last write wins.** Netlify Blobs has no compare-and-swap. Two people filing in
  the same second could clobber one another. With five friends and a daily round
  the exposure is small, but it is real and it is not solved.
- **Nothing tells you a round has closed.** No email, no push. The group chat is
  the notification channel. That is a genuine design position for a game played
  with friends, not an oversight — but it is a position, not a fact.
- **The bot layer is not parity-tested.** The economy is verified against Python to
  1e-06; bot humanisation is JavaScript only. Bots are decided server-side, so this
  costs nothing today.

---

## 19. Borrowing, and launching in live sessions

Two additions that turned out to be the same feature: a new product line usually
has to be borrowed for, and borrowing is priced on how healthy the company looks.

### The rate

Anchored to what borrowing actually costs. As of 13 August 2026 investment-grade
corporate paper trades around 1% over treasuries, all US high yield at 271 basis
points, and CCC-and-lower at **10.24%** — roughly a tenfold span from sound to
distressed. The curve reproduces that shape:

```
rate = 4%  +  10% × leverage^1.4  +  5% × impairment × exposure     (capped 22%)
```

- **Leverage** is how much of the credit line is drawn, raised to 1.4 so the first
  quarter is nearly free and the last quarter is punishing. That is what makes
  borrowing early to fund something a different decision from borrowing late to
  cover a loss.
- **Impairment** is the average of the last three rounds' profit, as a fraction of
  an $80,000 loss.
- **Exposure** scales the loss penalty by leverage. Without it, a brand-new company
  with $190,000 in the bank was rated *Stretched* in round one purely for the
  ordinary cost of starting up. A company that owes nothing is not distressed
  however its quarter went.

| Situation | Rate | Called |
|---|---|---|
| No debt, losing while ramping | 5.0% | Strong |
| Small overdraft, losing | 5.5% | Sound |
| Half the line drawn, profitable | 7.3% | Sound |
| Deep in, losing | 12.9% | Strained |
| At the limit, bleeding | 18.7% | Distressed |

**It makes a crisis harder to survive, by a measured amount.** A company dropped to
60% of its credit line with a losing record, then played well: bankruptcy rises
from 58% to 71% (crisis at round 4), 46% to 54% (round 6), and 33% to 46%
(round 8). Recovery stays possible in every case — the rate raises the stakes, it
does not replace the decision. `RATE_LEVERAGE` is the dial if that is too sharp.

**It caught a bug in the solo game.** The practice level promises an exact
projection, and the projection was computing interest at the flat constant while
the engine charged the real rate — so it quietly understated costs for any company
carrying debt. Both now use `creditRate`.

### Launching, and why it needed three attempts

The first version required the $180,000 in cash. Measured over 24 seasons at four
companies, a player had that much spare in **fewer than one game in eight** — so
the answer to a maturing product effectively did not exist.

Allowing it to be borrowed made it available and **fatal: 96% bankruptcy**. The
affordability test was wrong. It asked "can this be paid for" when the question is
"can the ramp be survived" — a new line costs about **$87,500 a round more than the
round before it** (its own $40,000 fixed cost, $36,500 of extra corporate overhead
from `CORP_SCALING`, $11,000 of plant upkeep) and takes two rounds to reach full
demand. A firm that borrowed most of its line to launch met that round with nothing
left to draw and died two rounds later. `LAUNCH_RESERVE` now requires $135,000 of
room to remain after paying.

A new line also **inherits the company's know-how** — 85% of its best product's
quality, 90% of its efficiency. A product starting at quality 100 against
incumbents at 130 cannot get share, for exactly the reason §17 found a new entrant
cannot. Unlike a quality gift to an outsider this scales with the launcher, so it
has no "no setting in between" problem. It is also simply true: a second product
from an established company is not a startup's product.

### Where launching stands — measured, and not flattering

24 seasons per cell, four companies, launching at the stated round versus never:

| Game length | Never | Launch r2 | Launch r7 | Launch r11 |
|---|---|---|---|---|
| 12 rounds | $229k, 0% bust | $197k, 17% | $223k, 0% | — |
| 16 rounds | $224k, 8% bust | $197k, 17% | $224k, 8% | $198k, 8% |
| 20 rounds | $224k, 8% bust | $197k, 17% | $224k, 8% | $198k, 8% |

**Launching is survivable but still costs about $27,000 of median company value and
roughly doubles the chance of going under.** No timing was found where it reliably
wins. The structural reason is in the numbers above: $87,500 a round of new fixed
cost against roughly $46,000 of gross margin while the line ramps. It pays back
only if the line reaches maturity in a market that has not moved on.

Two honest readings, and both are defensible:

1. **It is a real bet that usually does not come off**, which is a legitimate thing
   for a business game to contain — the lever exists, the cost is visible, and a
   player who takes it against a maturing product in a thinning market may be right
   where the median is not.
2. **It is not yet worth taking**, and the constants to move are `PRODUCT_FIXED`
   ($40,000 a round for a second line is heavy) or `RAMP` (two rounds at 65% and
   90% is a long time to carry it).

`CORP_SCALING` was tested as the culprit and is not: flattening it from 1.30 to
1.00 changed the outcome by less than $5,000.

### And the cap on game length was wrong

The 8–14 range in §18 was set because a single product runs out of road. With the
current constants that is not what the numbers say — **never launching, a 20-round
game ends at $224k against a 12-round game's $229k**. The decline plateaus rather
than compounding. The cap can go back up whenever the interface is ready to present
a longer game; it is a settings change, not an economy one.

### What a player sees

- **Solo:** a permanent readout in the header — `7.3% · Sound` — and, when a plan
  would overdraw, the warning quotes the rate *that plan* would be charged rather
  than a headline number.
- **Live:** a Borrowing card showing the standing, the rate, what is drawn, what is
  left, and this round's interest, with a bar that turns red as the line fills. The
  launch checkbox states how much would be borrowed before it is ticked.

Sources: [ICE BofA CCC & Lower US High Yield OAS](https://fred.stlouisfed.org/series/BAMLH0A3HYC) ·
[US High Yield credit spread (OAS)](https://convextrade.com/metrics/bamlh0a0hym2)

---

## 20. What kind of thing you make

Every constant in §5 through §7 describes one business: a manufactured physical
good. Materials in each unit, a factory that costs money standing idle, a
warehouse, stock that rots on the shelf, and a Wright's-law learning curve that
only means anything if you are physically building things.

| Constant | What it assumes |
|---|---|
| `UNIT_COST0` 45 | materials and labour in every single unit |
| `LEARN_EXP` −0.12 | you get better at *making* it the more you make |
| `CAPACITY0` / `CAPEX_PER_UNIT` / `CAPACITY_UPKEEP` | a factory, which costs $5 a unit a round whether it runs or not |
| `HOLDING` 0.22 / `OBSOLESCENCE` 0.10 | a warehouse, and stock that loses value in it |
| `SALVAGE` 0.40 | unsold stock is a physical thing, so it can be dumped |

Software has none of that. Nor does a commodity behave like deep tech. So a launch
now picks what kind of thing the new line is.

### The four kinds

Multipliers on the baseline, which means **`hardware` is exactly the economy every
figure in this document was measured against** — nothing already balanced moves. A
company always starts with a hardware product; the choice is made when launching.

| | Up front | Per unit | Factory | Stock | Research | Ages |
|---|---|---|---|---|---|---|
| **Hardware** | $180,000 | $45.00 | yes, full | yes | baseline | baseline |
| **Software** | $180,000 | $4.05 | none worth the name | none | 1.15× | **1.6× faster** |
| **Commodity** | **$70,200** | $27.90 | small | yes | **0.45×** | 0.7× slower |
| **Deep tech** | $207,000 | $51.75 | yes, full | yes | **1.7×**, one round later | baseline |

Software's fixed cost is **1.75× hardware's** — no factory, but the people are
expensive — and its quality decays 60% faster, which is the software business in
two numbers. Commodity is a third of the price to start and research barely moves
it. Deep tech costs more of everything and takes an extra round to land, but
research compounds at 1.7×.

**Know-how carries across, but not for free.** A new line inherits 85% of the
company's best quality and 90% of its efficiency — *if it is the same kind of
thing*. Across kinds it carries only 60% of that. A factory's process learning is
worth much less to a software product, and without that discount "launch a
different kind" would be a free reset into whichever kind is currently strongest.

Verified against the Python engine across all four kinds over a full product life:
**zero divergence.**

### A correction to §19

§19 concluded that launching costs about $27,000 of median value and never pays.
**That was wrong, and the error was in the measurement, not the game.** The median
was taken over all 24 seasons — but in most of them the launch never happened,
because it was unaffordable. Averaging in two dozen seasons where nothing occurred
buried the effect of the handful where it did, which is also why hardware and
software appeared to produce identical results.

Measured over **only the seasons where a launch actually happened**, against the
same company never launching:

| Kind | Launch round 3 | Launch round 6 | Launch round 9 |
|---|---|---|---|
| Hardware | 2 of 24 could afford | 3 of 24 | **+$190k**, 0% bust, 9/24 |
| Software | 2 of 24 | 3 of 24 | **+$177k**, 0% bust, 9/24 |
| Commodity | **−$414k, 58% bust** | −$228k, 29% bust | **+$134k**, 5% bust, 22/24 |
| Deep tech | 2 of 24 | 0 of 24 | **+$303k**, 0% bust, 4/24 |

Three things fall out of that table, and none of them were designed in:

**Timing is the whole decision.** Launching in round 3 is close to suicide —
commodity, the only kind cheap enough to do it early, loses $414,000 and goes under
in 58% of seasons. The same choice in round 9, once the first line is mature enough
to carry it, is worth between $134,000 and $303,000. The lever is not good or bad;
it is early or late.

**Cheap to start is not cheap.** Commodity is the only kind almost anyone can
afford (22 of 24 seasons) and it has the *worst* payoff of the four. Its $70,200
price tag buys a line that cannot be innovated — research at 0.45× — so it competes
on price forever in a market where share follows quality at an exponent of 3.2.

**Deep tech pays best and is hardest to reach.** Only 4 of 24 companies could
afford it even at round 9, and those that could gained the most. That is the right
shape for the expensive option, and it took a correction to get there: at its
original $261,000 it was reachable in 1 season out of 24 — a lever nobody could ever
pull is not a choice, it is decoration.

### What is still not settled

The kinds are balanced against each other only at the launch decision. Nobody has
measured a *company* built around software from round one, because §20 deliberately
kept the starting product uniform. If the starting kind ever becomes a choice, every
figure in §10 and §11 needs re-measuring — the shared market, the five bot
personalities and the price equilibrium were all derived with four identical
manufacturers in the market.

---

## 21. The clock, and the length of a game

§18 built live sessions around one round a day, because that was the answer to the
synchronous-or-asynchronous question. Playing it made the limitation obvious: a day
a round is right for a game running in a group chat across a fortnight, and wrong
for four people who want to sit down together and run a company's whole life in an
evening. They are the same game. Only the deadline differs.

### The host picks

| Round lasts | A 20-round game takes | Suits |
|---|---|---|
| 5 minutes | **51 minutes measured** | Everyone at their screens at once |
| 15 minutes | 5 hours | Room to think without losing the thread |
| An hour | 20 hours | Dipping in across an afternoon |
| 4 hours | 3 days | A few rounds a day |
| A day | 20 days | A group chat, at a fixed hour |

**A daily game keeps its fixed hour; nothing shorter has one.** "Closes at 18:00"
is easier to live with than "23 hours after whenever the last one happened to
close" — but at five minutes a fixed hour is meaningless, so those simply run from
the moment the previous round resolved. The close-hour setting hides itself unless
the game is daily.

**The first round of a fast game gets double time.** Everyone has just arrived and
is reading the screen for the first time; five minutes to absorb an interface and
file a first set of orders is not the same as five minutes to adjust them.

### What had to change with it

**The backstop went from hourly to every five minutes.** Rounds normally close when
the next player opens the page, so the scheduled function is only for a game
everyone has walked away from — but an hourly sweep would freeze a five-minute game
for most of an hour if every tab was closed mid-round.

**Polling follows the pace.** The client checked the server every 25 seconds, which
is generous for a daily round and useless for a five-minute one. It now polls every
6 seconds when a round is an hour or less, and the countdown shows seconds under
five minutes — at a day the seconds are noise, at five minutes they are the whole
tension.

Measured over a full 20-round game at five minutes: 11 rounds closed early because
everyone had filed, 9 ran out the clock, and standing orders filed 9 sets of orders
for players who missed a deadline. Both closing paths work at speed, and being late
still carries you rather than freezing everyone else.

### And the round cap went to 20

§19 measured that the decline plateaus rather than compounding — never launching, a
20-round game ends at $224k against a 12-round game's $229k — and noted the 8–14 cap
could go back up "whenever the interface is ready to present a longer game". At five
minutes a round, 20 rounds is under an hour. It is ready.

---

## 23. The ranked tier

Two tiers, and the split is forced by one problem: a leaderboard over
host-configured games is a scoreboard for whoever tunes the settings hardest.
Twenty rounds on Forgiving against two weak bots posts a number nobody playing
properly can approach.

So **only the public format is rated**, and it is fixed: 5 companies, 8 rounds, a
round every 5 minutes, standard difficulty — about 40 minutes end to end. Private
games keep every setting the host wants and count for nothing.

### Length is chosen for strangers

Fifteen minutes a round over ten rounds is two and a half hours of attention from
people with no obligation to each other. Friends finish a long game because they
would be letting each other down; strangers close the tab. Five minutes and eight
rounds is short enough to see through, and standing orders carry anyone who drifts.

A table starts when it fills **or after 90 seconds**, whichever comes first, with
hidden bots taking the empty seats. So a single player still gets a real game on a
quiet evening — the cold-start problem that usually kills a public tier is already
solved by a mechanic built for something else.

### What is rated, and what it costs to farm

Rating is the ordinary pairwise generalisation of Elo over finishing positions.
Bots are in the pool as ordinary opponents, with ratings taken from the win rates
measured in §20 — Premium 33%, Discounter 30.5%, Balanced 17%, Operator 10%,
Marketer 9.5%, against an even split of 20%. So beating a strong bot is worth
something and beating a weak one is not, with no special case saying so.

Measured:

| Situation | Rating change |
|---|---|
| Win against four 1800-rated humans | **+20** |
| Win against four strong bots | +14 |
| Win against four weak bots | +9 |
| **1800-rated player wins against four weak bots** | **+2** |
| 1800-rated player comes last against them | **−22** |

Farming is not worth the forty minutes it takes, and losing to weak opposition is
expensive — which is the right way round.

Only companies with a purchased name are rated. Everyone else, bot or human,
counts as opposition: they affect what a win is worth without having a standing of
their own. That is also the honest reason to buy a name, and it means the free
tier stays genuinely free rather than crippled.

### Scored exactly once

A finished game writes one row per company, with a unique index on
(game, company name). Two requests finishing the same game at the same moment, a
re-read, and the scheduled sweep all try to score it; the index means one
succeeds. Verified by scoring a game, clearing the in-memory guard, and scoring it
again — the database refuses.

---

## 24. Classes

A facilitator's problem is not playing but watching. Forty students is eight games
of five, and the questions are always the same: who has filed, which group is
stuck, whose company just went under, and what goes in the gradebook.

### One seed, eight groups

Every group in a class runs from the cohort's seed, so all of them face an
identical market — the same shocks in the same rounds, the same news. Nobody can
claim they drew a harder economy, which is what makes comparing groups defensible
rather than merely convenient.

This is the feature the incumbents charge for, and here it cost nothing: games
have been seeded since the first prototype, because reproducibility was needed for
testing. A property added for one reason turning out to be the commercial
differentiator for another is worth noticing.

Verified rather than assumed: eight groups, one distinct seed between them, and
identical first-round news across all eight.

### The controls a real room needs

| Control | Why it exists |
|---|---|
| Start every group | Nobody wants to start eight games by hand |
| Pause | A discussion, a fire drill, half the room stuck |
| Extend by ten minutes | Somebody always says "we are not ready" |
| Close this round now | The opposite problem: three groups waiting on one |
| Download results | The artifact that goes in the gradebook |

Pausing is enforced inside `shouldResolve`, so a paused class cannot tick on even
if the scheduled sweep runs — the check lives in the rule rather than in the
interface.

### The export, and two things it got wrong first

The CSV is one row per company per group: group, game, company, whether it was a
student or AI, finishing place, company value, rounds played, **rounds filed** and
**rounds auto-filed**.

That last column is the social-loafing measure the incumbents approximate with
peer evaluation, except it is objective — it counts the rounds a student let run
on standing orders, and the game has tracked it since live sessions existed.

Two defects the test caught:

**Company names are typed by students, and a spreadsheet treats a cell beginning
with an equals sign as a formula.** A company called `=cmd|calc` is a
formula-injection attempt aimed at whoever opens the file. Names now get a leading
apostrophe.

**But the first fix escaped negative numbers too**, so every company value with a
minus sign arrived as text and the instructor could not sort or total the column —
which is most of the point of an export. Numbers now pass through untouched; only
text that looks like a formula is neutralised.

### What is still missing for an institution

Single sign-on and gradebook syncing with Canvas or Blackboard are what make a
tool *purchasable* by a university rather than merely usable by an instructor.
Neither is built, and neither should be until an instructor has actually run a
class and said which five things matter — which will not be the five anyone would
guess.

## 25. The demo class

Stage 3 built the thing an instructor needs. This is about whether they will ever
find out it exists.

### The door is the product

An instructor evaluating a teaching tool is doing it at eleven at night, between
other things, having clicked a link somebody sent them. Everything that happens
before they see the thing itself is attrition, and the single largest piece of it
is a sign-up form. So the demo has none: no email, no password, no name, no
"start your free trial". One button, and the class opens.

What makes that safe rather than reckless is that the demo class **belongs to
nobody**. Its `facilitator` column is null. Control comes from a random token
handed back with the class, which opens that one throwaway cohort and nothing
else — it is not an account, it grants no entitlement, and it expires. The tests
that matter here are the refusals: the same token on somebody else's class, a
second visitor's token on the first visitor's class, the token used to create a
*real* class (402 — running a class still needs the licence).

### An empty dashboard demos terribly

The obvious version of a demo is an empty class with a join code, which shows the
instructor precisely nothing and asks them to imagine the rest. So the demo is a
class that is already running: six groups of five, five rounds played, caught
mid-round with about a quarter of the room still to file.

Everything in it is the ordinary code. The thirty companies are human seats with
tokens the demo module happens to hold, filing ordinary orders through the
ordinary submit path. There is no demo branch inside the engine, the cohort logic
or the game logic. If the demo works, the product works — which is the only kind
of demo worth showing.

### The story it tells

A dashboard of six groups explains nothing on its own, so the demo is written
rather than merely generated. Three things are on it deliberately:

**A price war in group three.** Two companies running the *same* strategy, so the
only thing separating them from each other and from the rest of the group is the
war. Neither follows a script that says "charge sixty per cent": each undercuts
what the other charged last round by six per cent, one round late. That is what a
price war is, and it is why they do not stop — there is no round in which cutting
is the wrong move for either of them, and they arrive at the bottom together. By
round twelve four of the five companies in that group are out of business and the
one that stayed out of it is worth $748,000. Nobody scripted that outcome; it
falls out of the economy.

**A student who has never filed.** This is the instructor's actual fear, and the
answer to it has to be visible rather than asserted: their last orders repeat,
nothing stalls, the company keeps trading, and the count follows them into the
spreadsheet as `rounds_auto_filed`. A second student files twice and then stops,
because that one is commoner than the first.

**Why so many are underwater.** Five rounds in, seventeen of thirty companies
show a negative company value, and an instructor reading that cold would
reasonably conclude the simulation is broken. It is the ramp: a product loses
money for its first rounds and a company is valued on what it earns. Saying so
turns a confusing signal into the reason to press the button.

The guide is computed from the board rather than hard-coded, so if the simulation
ever stops producing the story the guide stops claiming it. Its numbers move when
the class moves — which the API test checks by comparing the sentence before and
after a fast-forward.

### The same story every time

The seed is fixed and every scripted decision is deterministic, so "look at group
three" means the same thing in every session — the demo can be screenshotted,
written about, and narrated in a call. Two visitors opening it a second apart get
byte-identical boards, which is asserted rather than hoped for.

Two things had to be fixed to make that true. Joins are staggered by a second,
because cohorts number groups by creation time and thirty games created in the
same millisecond number themselves differently on every run. And each company is
nudged off its archetype by an amount derived from its own name: six groups of
five people running the same five strategies produced three *identical* columns of
numbers, and an instructor scanning that would rightly conclude they were looking
at a mock-up.

### Time compression

Nobody watches fifteen-minute rounds in an evaluation. The demo can be pushed
forward one, three or five rounds at a time — the scripted students file, the
class resolves, and the visitor's own seat is left to its standing orders, which
demonstrates the standing-order rule without a word of explanation. Five rounds is
the cap on one click, so a single button cannot silently run the whole class out.

Fast-forward exists **only** for demos. A real class's rounds belong to the people
playing them, and the route refuses the action on a non-demo cohort even for its
owner.

### The seat

The one thing a dashboard cannot show is what a student sees, so the visitor is
handed a real seat in group one — played for them up to the moment they arrive, so
it has a history to read. It is a seat and not a skeleton key: mid-game it reveals
no more than any student's would, which the API test checks by confirming the
who-was-who column is still null.

### Letting them take the spreadsheet

The export is on the demo, unauthenticated, with the same content as a paying
facilitator's. That is deliberate. Software spreads inside an institution by
somebody forwarding a file to somebody else, and a gradebook export is the most
forwardable thing this produces.

### What it costs

A demo is six games written on creation and swept afterwards, so demos carry an
expiry and the scheduled tick deletes them; `games.cohort_id` cascades, so nothing
is orphaned. Building one takes about 35ms — thirty round resolutions — which is
cheap enough to do inside the request that asked for it.

### The tuning that was needed

The first version was unusable as a demo and the reason is worth recording. The
scripted students spent far more than the archetypes they were modelled on —
heavier R&D, heavier advertising, and compounding capacity growth funded on the
credit line — and **fifteen of thirty companies were bankrupt by round twelve**. A
demo class where half the room has gone under does not demonstrate a simulation;
it demonstrates a broken one.

Pulling the spending back towards the measured baseline (§20's bot archetypes)
brought it to seven of thirty, concentrated where the story wants them: the price
war group, the student who never files, and the one who stopped. That is a class
an instructor recognises.

## 26. Going live, and what it cost

The game was finished and tested for weeks before it was deployed. Deploying it
took an evening, and none of that evening was spent on the game. It is worth
writing down, because every hour of it was spent on something that could have
been made impossible.

### Four failures, in the order they were hit

**The functions had no dependencies.** `package.json` in the repository was the
one from before accounts existed, listing `@netlify/blobs` and
`@netlify/functions` and neither of the two things every request actually needs.
The site is deployed by uploading files, folders were re-uploaded one at a time,
and the root files were never among them. The build succeeded. Every request
returned a 502 with an empty body.

**The server crashed before it could say why.** `getDb()` was called on the way
into the handler, outside the try block, so a server with no database threw before
any route existed — including `/api/config`, the one the page uses to find out
what it is talking to. The interface had no way to report a problem because the
first thing it asks is the thing that was broken. Storage is opened lazily now,
`/api/config` and `/api/public/format` answer without it, and a missing database
produces a 503 that names the setup step.

**Node 20 has no WebSocket.** The Supabase client builds a realtime connection as
it is constructed and looks for a global `WebSocket`; Node did not have one until
22. `netlify.toml` pinned 20. The constructor threw during module import, so
again: dead function, empty 502, no clue. Nothing here uses realtime — the
dependency was on the constructor, not on us — so the client is now given a
transport that would refuse to dial, and the server no longer cares which Node it
is handed. `netlify.toml` says 22 as well, because two of these is not excessive
for a failure that presents as silence.

**Nobody could tell which version was live.** Diagnosing the above meant
comparing git blob hashes between the working copy and the GitHub tree API, and
probing routes for fields that only exist in newer code. Twice, a fix was assumed
live when the file had never been uploaded — the fix was correct and the
conclusion drawn from its apparent failure was wrong.

### What actually fixed it

A label. `lib/version.mjs` exports a build string; it is returned by
`/api/config`, stamped into `public/live.html` at build time, and printed at the
bottom of every screen:

```
page 2026-08-17 · ranked tables are private · server 2026-08-17 · ranked tables are private
```

Two of them, because the page and the server are uploaded separately and having
one without the other is precisely the confusion that cost the most time. "Is my
change live?" is now a thing anyone can read off the screen.

### The pattern

Three of the four failures presented identically — an empty 502 — and had
completely different causes. That is the signature of a system that cannot
describe its own state. The tests were excellent at proving the code correct and
useless at proving the deployment correct, because every one of them ran against
a filesystem where the files were, by construction, the right ones.

So there are now two tests that assert the *absence* of a working environment
rather than the presence of one: `test/unconfigured.mjs` runs the real handler
with no database and no environment and requires a readable message on every
route, and `test/nodeversion.mjs` deletes the global `WebSocket` and requires the
whole API to load anyway. Neither tests a feature. Both test the half-hour after
somebody presses deploy, which is when a thing is at its most fragile and least
observed.

### And two things the deployment surfaced about the game

Neither was a deployment problem; both were found by a real person opening the
real site, which is the argument for shipping.

**A free public table handed out a shareable code.** The lobby screen had been
written for private games — where the code is the whole point — and public tables
were routed through it without anyone asking whether the code still belonged. Two
consequences: four friends could fill a "public" table and settle the finishing
order between them, which is the end of the rating meaning anything; and the
thing a host pays for, choosing who plays, was available for nothing. Removing the
share box was not the fix. The code was also in the header chip, in the saved
games list and in the address bar — and hiding a code is not a rule anyway. The
rule is on the server: a public table refuses to be joined by code, and refuses to
be watched without a seat token. A code that lets you watch is a code that lets
you coach.

**The first round of a fast game is twice as long, and said nothing about it.**
That was a deliberate decision — at round one of a five-minute game everyone is
reading the screen for the first time — and an accidental lie, because the front
page promises a round every five minutes and the clock then reads nine and a half.
The player's available conclusion is that the game is broken, which is the
conclusion that was drawn. The number was right; the silence was the defect. Round
one now says what it is doing and why.

## 27. The leaderboard, and what eight rounds was hiding

The board was a rating. Ratings are the right way to measure skill and the wrong
thing to put on a shop window: they are stable by design, so the top belongs to
whoever got there first, and somebody who buys a company name on Tuesday and
plays brilliantly sees no evidence of it anywhere. The board is the *reason* to
buy a name. It has to be winnable this afternoon.

### The measurement that changed the question

The proposal was "money made over the starting amount, decaying". Measuring what
the public format actually produces killed that idea in its original form and
turned up something worse.

Forty public games, one competent player, current bots:

| rounds | median final value | profit over the $250,000 start | players in profit |
|---|---|---|---|
| 8 | $187,916 | **−$62,084** | 25% |
| 10 | $302,571 | **+$52,571** | 60% |
| 12 | $365,073 | +$115,073 | 65% |
| 14 | $506,198 | +$256,198 | 65% |

**The ranked tier ended before the company was worth anything.** Eight rounds
stops the game inside the ramp: everyone has spent cash building a business that
has not paid back yet, so the median company finishes worth less than it started
and the winner of a ranked table is whoever lost least. That is a strange thing to
be best at, and nothing about the leaderboard would have revealed it — the Elo
board ranks *relative* finishes, so it looked perfectly healthy while measuring a
race to the bottom of a hole.

Ten rounds, at ten more minutes, moves the median to +$52,571 and puts 60% of
players in profit instead of 25%. Twelve is better still, and an hour is too long
to ask of a stranger with no social reason to see it out. §21 measured game length
before launching existed and concluded the decline plateaus; this is a different
question — not "how long stays interesting" but "how long before there is anything
to show" — and it needed its own measurement.

### Best game, not total

The decay rate was proposed at 10% an hour, which is fast: half a result gone in
6.6 hours, ninety per cent inside a day. That is right for the purpose. Nobody
holds the top by having been good yesterday, and every entry is quietly making
room.

The decision that actually matters is what decays. Adding a player's recent games
up sounds fairer and is not. At 10% an hour a player going back to back settles at
about twelve games' worth, so the board ranks free time rather than judgement —
measured directly: twenty-four games at $120,000 each totals $1,237,552 against
one $300,000 game an hour ago, **4.6 times the score**. Six mediocre games would
beat one brilliant one, and the leaderboard would be a stamina contest with a
company-simulation theme.

Taking each company's *best single recent game* fixes it exactly. Playing more
only helps if you play better. The test that proves it also computes what the
totalling rule would have paid, because a claim about a design choice is worth
nothing unless the rejected alternative really would have won.

A game that finished below its starting cash scores zero rather than a negative.
A leaderboard of losses is not a leaderboard, and somebody having a bad afternoon
should not be ranked below somebody who has never played.

### The rating is kept

It moved rather than died. The board answers "who has built the best company
lately"; the rating answers "how good is this player", which is a different
question with a different right answer, and the Elo work — pairwise, K by
experience, bot ratings from the measured win rates in §20, farming-resistant —
is still the honest answer to it. It now sits on your own record, where a
permanent number belongs, next to the thing that decays.

Nothing new is stored for any of this. A result already recorded what the company
was worth and when; the board is that table, read over two days, with one
exponent applied. Anything older has decayed below a hundredth of itself and
cannot reach a board of twenty-five, which is why two days is the whole window.

## 28. Should paid and unpaid players be kept apart?

The worry is reasonable: a beginner who has not bought anything gets seated with
people who have been playing for weeks, is beaten every time, and leaves. Splitting
the queue looks like it protects them.

Measured over 400 public tables — bots dealt as they normally are, then the games
sorted by how strong a table each player happened to draw:

**A competent player:**

| table drawn | avg opponent | won | median company | in profit |
|---|---|---|---|---|
| softest third | 1463 | 32% | $252,507 | 50% |
| middle third | 1484 | 31% | $258,887 | 50% |
| hardest third | 1497 | 32% | **$294,117** | 58% |

**A beginner filing the defaults:**

| table drawn | avg opponent | won | median company | in profit |
|---|---|---|---|---|
| softest third | 1463 | 29% | $232,107 | 47% |
| middle third | 1484 | 26% | $238,746 | 49% |
| hardest third | 1497 | 30% | **$284,494** | 58% |

**A harder table makes you better off, not worse.** $41,610 more company value for
the competent player and $52,386 more for the beginner, between the softest third
and the hardest — and the chance of finishing first is flat across all three.

The mechanism was designed in and its consequence was not noticed until now: in
this economy **a firm brings its own customers**. The category is not a fixed pot
to be divided; demand grows with the quality and awareness of the companies in it
(§4, §13). Strong rivals advertise more and research more, so they enlarge the
market you are selling into. You take a similar share of a bigger thing.

Three conclusions fall out.

**Splitting the queue would hurt the people it was meant to protect.** A beginners'
table is a smaller market. They would finish just as often and be worth $50,000
less for it.

**The money board is not farmable by drawing weak opponents.** This was the real
risk in moving the board from a finishing position to an absolute number, and the
incentive turns out to run the other way — a soft table is the one you would rather
not have. Nobody can pick their table anyway, but it is worth knowing that if they
could, they would want the hard one.

**Payment is not skill.** Matching on it sorts by the wrong variable: somebody who
buys a name on their first day is still a beginner, and a strong player who never
pays is still strong. The rating already measures the right thing, and the bot
archetypes already carry measured standings (§20), so if the queue is ever split
it should be split on that — not on who has spent money.

There is also an arithmetic point that decides it at this size. At launch the
public pool is small. A paid-only queue is an empty queue, and the outcome is that
the people who paid sit alone with bots while everyone else gets a full table.
Whatever the theory, that is the wrong way round.

No change was made. The measurement is the deliverable.

## 29. What a million games a month costs

Measured from the code rather than estimated, because the answer turns on one
number and it is not the one people expect.

### One public game

| | |
|---|---|
| stored game document | 47.2 KB |
| a view sent to one player | 4.0 KB at round one → 17.4 KB at the end |
| game length | 50 minutes |
| **polls, at the current 6-second interval** | **500 per player, 2,500 a table** |
| order submissions | 50 |

**Storage is not the bill and never was.** A million finished games is 45 GB —
about $5 a month of Supabase disk, and nothing at all if the game document is
dropped a week after the game ends and only the result row kept.

**The bill is the poll.** 2,550 function calls per game becomes **2.55 billion a
month**, which is 984 database queries a second sustained, 26.6 TB of bandwidth,
and 70,833 GB-hours of function compute.

### The bill

Netlify is credit-based: 2 credits per 10,000 requests, 20 per GB of bandwidth,
10 per GB-hour of compute, at roughly $0.0067 a credit. Supabase charges for the
instance, the disk and egress rather than per query.

| polling | calls/month | queries/sec | Netlify | Supabase egress | total |
|---|---|---|---|---|---|
| **every 6s (as shipped)** | 2.55bn | 984 | $11,813 | $10,308 | **$22,121** |
| every 15s | 1.05bn | 405 | $4,864 | $4,231 | $9,095 |
| every 30s | 0.55bn | 212 | $2,548 | $2,206 | $4,753 |
| every 60s | 0.30bn | 116 | $1,390 | $1,193 | $2,583 |
| adaptive | 0.45bn | 174 | $2,085 | $1,801 | $3,885 |

Plus a Postgres big enough to take the query rate — at 984/s that is a large
compute add-on, several hundred dollars a month, and at 100/s a small one.

So: **about $22,000 a month as it stands, and about $4,000 for the same million
games with a smarter client.** The difference is entirely in how often a page that
has nothing new to say asks anyway.

### Why it is so wasteful

Of the 500 polls a player makes in a game, about twelve find anything new. **97%
of all traffic is a page being told exactly what it was told six seconds ago.**

Three fixes, in order of how much they return for the work:

**Poll adaptively.** The client already knows the deadline. Between rounds the only
thing that can change is whether somebody else has filed, which is not urgent —
so poll every 30 seconds, then burst in the last few seconds before the deadline
when the round is actually about to turn over. Eight polls a round instead of
fifty. That is the $22,000 → $3,900 line and it is perhaps thirty lines of client
code.

**Answer an unchanged poll with nothing.** A round number and a "who has filed"
count are enough to know whether a full view is needed. Sending an empty response
instead of 11 KB takes the bandwidth line from $3,650 to about $109. It does not
reduce the invocation count, which is the larger half.

**Do not read the game document to answer a poll.** A poll currently loads the
whole 47 KB game to produce a view. A tiny `games(code, round, updated_at)` read
answers "has anything changed" for a fraction of the egress, and that is where the
Supabase side of the bill lives.

### The honest caveat

A million games a month is 33,000 a day, or roughly 1,400 concurrent tables in the
evening. Nothing at this scale should be believed from arithmetic alone — the
first thousand real games will move these numbers. But the *shape* is reliable and
it is worth knowing now rather than at ten thousand games: the cost is polling,
polling is 97% waste, and the fix is in the client rather than the bill.

### What you would have to charge

The direct answer, from the costs above:

| | cost of one game | per player |
|---|---|---|
| as it ships | $0.0221 | $0.0044 |
| adaptive polling | $0.0039 | $0.0008 |

For a 90% margin that is **$0.22 a game now, or $0.04 with adaptive polling** —
under a penny either way, which is the finding rather than the answer. Nobody can
charge four cents a game, and more importantly nobody should try: the friction of
asking for money at all is worth more than the money.

What the numbers actually say is that **a one-off purchase funds a lifetime of
play**. A $25 name is $23.98 after Stripe, which covers 30,856 of that player's
own games — decades, at twenty games a month. Even at the wasteful polling rate it
is 5,419 games, or twenty-three years. There is no version of this where a paying
customer costs you more than they paid.

And the free rider, which is the thing a free public tier is supposed to make you
nervous about, is not frightening either: a thousand public games by somebody who
never buys anything costs **78 cents** with adaptive polling, or $4.42 without.

### Where the decision actually is

A million games a month at five seats is five million player-games; at twenty
games a month each, a quarter of a million active players. Against an
infrastructure floor of about $455 a month (Supabase Pro, Netlify Pro, a 2XL
Postgres) plus $3,885 of usage:

**Break-even is 0.1% of active players buying a $25 name in a month.** One in a
thousand. At the un-optimised polling rate it is 0.4%.

| conversion in a month | buyers | revenue | cost | margin |
|---|---|---|---|---|
| 0.2% | 500 | $11,988 | $4,340 | 64% |
| 0.5% | 1,250 | $29,969 | $4,340 | 86% |
| 1.0% | 2,500 | $59,938 | $4,340 | 93% |
| 2.0% | 5,000 | $119,875 | $4,340 | 96% |

So the business is not sensitive to price and it is not sensitive to
infrastructure. It is sensitive to one number — **what fraction of people who play
ever buy anything** — and that is a product question, not a pricing one. Doubling
the price from $25 to $49 moves break-even from 0.1% to 0.0%; doubling conversion
from 0.5% to 1% adds $30,000 a month. The second lever is worth roughly ten times
the first.

The facilitator tier is a different business with different arithmetic. A class of
forty is eight games — three pence of infrastructure. A $199 licence covers six
thousand classes. That tier is priced entirely on what it is worth to an
institution and not at all on what it costs to run, which is the usual shape for
software sold to schools.

### The caution

These are the costs of *serving* games, and they are the easy costs. What is not
in this table: payment disputes, support, the person who emails at midnight
because their class will not start, moderation of company names on a public
leaderboard, and the fixed cost of your own time. At a quarter of a million active
players those dominate, and none of them appear on a Netlify invoice.

## 30. The classroom, and the bug it exposed

An instructor was going to put forty students in front of this. Rather than
imagine how that goes, it was simulated: forty joins issued at the same moment,
the way a room of students actually presses a button.

```
the dashboard shows 40 students in 40 groups
group sizes: 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, ... (×40)
```

Forty groups of one. Every student got a private game against bots. The product
is "students are seated into groups automatically", and it failed completely at
the only moment it is ever asked to work.

The cause was a read-modify-write with nothing guarding it: each request read the
list of groups, saw none with room because none of the others had been written
yet, and opened a new one.

### The same flaw, during play, on every game

If joining raced, filing would too. Five players filing at once, which is what
happens at every deadline:

```
five submissions sent, 1 recorded
LOST: Sableworth Ltd, Dunmore & Sons, Ketteridge, Ravensworth
      — each was told 200 OK
```

Four players in five lost their orders, were told everything was fine, and were
then carried by standing orders and marked as not having filed. This was not a
classroom problem. It was every game, all along.

The README had even named it, of the previous storage layer: *"Blobs has no
compare-and-swap, so two players filing in the same second could overwrite one
another. Moving storage to Postgres is the fix."* Postgres happened months ago.
The fix did not. A migration completed and the reason for the migration was
quietly forgotten.

### What fixed it

**Every write is conditional.** `games` carries a `version`; the update says
`where code = $1 and version = $2`, so a write built on stale state matches no row
and changes nothing. Silent loss became a loud error.

**Every mutation retries.** `lib/mutate.mjs` reads, applies, writes, and on
conflict re-reads and re-applies against whatever the other writer left behind.
This is only correct because each change is expressed against *whatever the game
currently is* — "record this seat's orders", "add this player", "resolve if due" —
rather than against a snapshot. Re-applying is therefore doing it right, not doing
it twice.

**Seats are allocated, not searched for.** A student takes a number from an atomic
counter on the cohort and their group is arithmetic. The group's game is created
exactly once by a unique index on `(cohort_id, group_no)`; students who lose that
race read the winner's row.

Forty simultaneous joins now produce eight groups of five, forty distinct seats,
every one of them openable. Five simultaneous filings produce five sets of orders
used. Both are permanent tests, and both do the thing genuinely concurrently
rather than in a loop, because a loop would have passed all along.

### The classroom clock

The same simulation turned up smaller things, of which one was a design error
rather than a bug. **The default class was ten rounds at fifteen minutes — two and
a half hours.** No lesson period is two and a half hours.

The fix is not a better default number, because there isn't one. An MBA course
meets weekly and plays a round between classes; a workshop plays three rounds in
an afternoon; a lesson overruns and needs to stop mid-round. Two cadences were
added:

**A week**, which is how the established classroom simulations are actually run,
and which the clock simply could not express before — it stopped at "a day".

**When I say**, which has no deadline at all. Rounds close when a group has all
filed, or when the facilitator closes them. This is now the default for a class,
because in a room the instructor *is* the clock, and it covers all three shapes
above without anyone having to pick a number that suits none of them.

A weekly game also needed its own lead time: the daily anchor would have closed
the first round the same evening, because six hours of lead is enough for a day
and absurd for a week.

### Still outstanding

The same simulation found things not yet fixed, recorded here so they are not
rediscovered by an instructor: a student arriving after the class has started
lands in a lobby of one that never begins unless the facilitator presses start
again, and the name filter refuses `Scunthorpe Ltd`, `Group 3 :)`, anything over
28 characters and anything under 3 — all of which happen in front of a room.

### The two the classroom simulation had left

**The latecomer.** A student joining after the class began was given a group of
one that never started, because starting groups is something the facilitator does
and they had already done it. The student watched "waiting to start" for the rest
of the lesson and the instructor had no way of knowing.

Groups opened while a class is running now carry their own starting deadline —
two minutes, long enough for a couple of stragglers to find each other, short
enough that nobody is stranded — and start themselves with AI companies filling
the rest, exactly as a public table does. The mechanism already existed; it was
gated on `isPublic` for no reason other than that public tables were where it was
first needed.

The second latecomer found the next problem: their seat number mapped to the group
that had just started, and joining a started game is refused. Seating now walks
forward to the next group rather than failing on the first one that is unavailable.

**The name filter, in both directions.** It refused `Scunthorpe Trading`,
`Rapeseed Oil Company` and `Shitake Farms` — a town, a crop and a mushroom — by
matching banned words as substrings of a name flattened to bare letters. That
refusal lands on the payment page, on somebody about to hand over money, and they
do not write in to complain about it.

Matching is now on whole words, which costs the ability to catch declensions and
buys back every legitimate name that happens to contain four unlucky letters. Two
prefixes survive, being the two with no innocent continuation. Digit substitution
is undone first, so `Sh1t Holdings` is caught. `f u c k it ltd` is still caught,
but by recognising the *shape* — three or more single letters in a row, which
nobody types by accident — rather than by flattening every name ever submitted.
Trademarks match as words too, so `Pineapple Ltd` is no longer refused for
containing `apple`.

And a name typed by a student is now tidied rather than refused. A purchased name
is exact, because that is what was bought; a student is one of forty people with
an instructor waiting, so `Group 3 :)` quietly becomes `Group 3` and a
thirty-six-character name is trimmed instead of rejected. Blocked words are still
blocked.

None of this makes the filter complete, and no filter is. `Barclays Bank plc` and
`Elon Musk Ltd` still pass. The honest answer to those is a report link and the
ability to revoke a name and refund it, neither of which exists yet — which is
recorded here rather than pretended away.

## 31. Adaptive polling

§29 found that the entire cost of running this is the page asking the server
whether anything has happened. Five hundred requests per player per game, of which
about twelve found anything new: **97% of all traffic was a page being told what it
had been told six seconds earlier.**

The fix is not to poll less often. It is to stop pretending the page does not know
what is going on.

### What the page already knows

It knows when the round closes. Between now and then, the only thing that can
change is whether somebody else has filed — which is worth knowing eventually and
never worth knowing within six seconds. So the page can sleep through the middle
of a round and be awake for the part where the round actually turns over.

| situation | it waits |
|---|---|
| a public lobby, filling | 5s |
| a private lobby, waiting for a host | 20s |
| mid-round, an hour to go | 300s |
| two minutes to go | 72s |
| twenty seconds to go | 8s |
| past the deadline | 4s |
| everyone has filed | 3s |
| one person left, and it is not you | 5s |
| a class with no clock | 60s |
| **the game is over** | **never again** |

That last row was a bug on its own: a finished game polled for ever, asking a
question whose answer could not change.

### The mistake in the middle of it

The first version ramped: poll every 30 seconds, then 15, then 3, as the deadline
approached. It felt careful and it only got traffic down 2.6x, because a gradual
ramp spends most of its requests in the middle of a round — precisely where
nothing can happen.

Sleeping *to* the endgame rather than ramping towards it took it to **7.1x**. One
long sleep lands the page at the end of the round having spent one request instead
of forty.

### The property that makes it safe

Sleeping is only safe if the page never sleeps far past the moment a round closes.
That is checked directly rather than argued: for every second of remaining time
from 1 to 3,600, the chosen wait is compared with the time left. **Worst case
across 3,600 starting points: never more than 10 seconds late.** A browser cannot
wake at a finer grain than its shortest interval, so the bar is that interval and
not zero.

Two other things fall out of taking the question seriously. A hidden tab waits two
minutes and refreshes the instant it is looked at again — people leave tabs open,
and browsers throttle background timers anyway, so this makes deliberate what was
already happening by accident. And filing re-arms the schedule immediately,
because having filed may have made the round the last one outstanding.

### What it costs now

| | before | after |
|---|---|---|
| requests per game | 2,550 | **400** |
| invocations at a million games | 2.55bn | **0.40bn** |
| database queries per second | 984 | **154** |
| Netlify | $11,813 | **$1,853** |
| Supabase egress | $10,308 | **$1,598** |
| **total** | **$22,121** | **$3,451** |

And the number that matters this year rather than that one: the free tiers now
cover about **275 games a month** instead of about 40. That is the difference
between paying $45 a month during the quiet period and not paying anything.

Two further reductions are known and not yet built, recorded so they are not
rediscovered: answering an unchanged poll with an empty response rather than 11 KB
of view, and not reading the whole 47 KB game document to decide that nothing has
changed. Together they are most of what is left, and neither is urgent at $3,451.

## 32. Analysis for the instructor

The dashboard tells an instructor the state of play. It does not help with the
hour afterwards, which is the hour the whole exercise exists for — and an
instructor who has spent fifty minutes supervising forty students has had no
chance to work out what happened.

Two things make this answerable rather than decorative. **Every group ran the
identical market**, so a difference between groups is a difference in decisions —
a sentence no generic dashboard can say. And **every decision is on the record**:
each round already stored what each company charged, spent on advertising and
research, sold, could not supply, and was worth afterwards.

### The groups, ranked

The single most useful table, because the market was the same for all of them:

| group | median company | price | advertising | went under |
|---|---|---|---|---|
| 2 | $338,074 | same as class | 15% above | 1 |
| 6 | $270,537 | 2% above | 5% above | 1 |
| 4 | $211,628 | 4% above | 23% above | — |
| 1 | $181,491 | 3% above | 7% below | — |
| 5 | $139,491 | 1% below | 12% below | 2 |
| 3 | **−$210,810** | **8% below** | **24% below** | **4** |

Read down it and the lesson reads itself: the group that charged least and
advertised least lost four of its five companies.

### Findings, not prose

Nothing here is generated writing. Each finding is a **shape somebody looked for**
— a price war, a company nobody had heard of, customers turned away, borrowing
while losing money, a second product line, what the leader did differently — with
the numbers attached and a question to ask the room. An instructor will be
challenged in front of thirty people and has to be able to answer.

Two things went wrong in the first version, and both are the same mistake.

**A finding argued against itself.** "Oakhanger Ltd spent almost nothing on
advertising, and ended worth $737,316 against −$210,810" — read aloud, that
contradicts its own claim in the same sentence. The check now requires the quiet
companies to have actually done *worse*. A company that spent nothing and won is
not this finding; manufacturing one is worse than staying quiet.

**Everything was a finding.** "Borrowed while losing money" fired in all six
groups, which is not six findings but one observation printed six times. Each kind
now has a cap and the survivors are the most pronounced instances. A list where
everything is important is a list nobody reads to the end.

### Three surfaces, one computation

The **dashboard view** for during and after class. A **debrief document** —
self-contained HTML, no scripts, prints and emails — for handing out. And a
**round-by-round spreadsheet**, one row per company per round with price,
advertising, research, quality, demand, sales, lost sales, share, inventory,
profit, cash and debt, for instructors who would rather do their own analysis.
All three read `lib/analysis.mjs`; none of them recomputes anything.

### And a bug it uncovered

Building the participation column exposed that `rounds filed` had been inferred as
`rounds played − rounds missed`, which looked equivalent and was not: a company
that goes under stops being counted, so a student who **never filed once in twelve
rounds was reported as having filed three of them**. Every round carries a flag
saying whether the orders were the player's own, so that is what is counted now.

Separately, the games list crashed on any game still in its lobby — seats with no
company behind them yet, and `finalValue` asked what they were worth. It failed
quietly into a fallback that dropped the "your move" column, which is the one
thing that list exists for. It presented as an intermittent test failure for two
sessions before being read properly.

## 33. The bot league

Somebody was always going to write a program to play this. The client is HTTP,
the state is JSON, and an afternoon's work turns a browser tab into a player.
The question is not whether it happens but what it does to the game when it
does — and that is measurable rather than arguable.

### How much of an edge is it, actually

An optimiser was written the way a competent person would write one in an
evening: it uses the same projection the page already shows every player,
searches over price, production and advertising, and takes the best expected
profit. It has no information a human does not have — rivals still commit
blind. Sixty ranked tables each:

| player | won | top half | in profit | median made |
|---|---|---|---|---|
| a beginner (the defaults) | 28% | 47% | 48% | −$5,589 |
| somebody who has worked it out | 30% | 47% | 52% | +$9,773 |
| a machine searching every round | 35% | 55% | **43%** | **−$22,607** |

The machine wins more tables and **makes less money** — it optimises the round
in front of it, so it underspends on research and advertising, both of which pay
back two rounds later. It is better at finishing first and worse at building a
company.

So the edge is real but small: five percentage points of win rate over a
thoughtful human. Not enough to justify an arms race of timing analysis and
typing-pattern detection, which would be a losing game that also insults every
person it got wrong. And large enough that ignoring it would slowly sour the
human board.

### The response: somewhere to go

A separate league. Bots play bots, on their own board, with their own key. The
human tier is unchanged and league results never touch it.

Three decisions shape it, and each one is a refusal of an obvious alternative.

**We never run anybody's code.** A bot lives on its author's machine and talks
to the ordinary API with a key. Accepting uploaded programs would mean
sandboxing them — a different and much larger product, and a security problem
nobody needs on day one.

**Rounds close when everyone has filed.** Bots do not need five minutes to
think, so a league game finishes in under a minute. There is still a
forty-five-second deadline, because one crashed program must not freeze a table
for everyone else — and a crashed bot's previous orders simply repeat, which is
the same treatment a person who closes their laptop gets.

**The board is an average, not a total or a best.** A total ranks whoever left
their bot running longest. A best ranks whoever drew the luckiest market. An
average over the last twenty games, minimum five, ranks the program — which is
the only thing worth ranking. Twenty games an hour per key, which is far more
than anybody needs to tune and far less than anybody could use to run up our
bill.

### The key

One per account, shown once, stored hashed — a key that can act on your behalf
should be treated the way such a thing is treated everywhere else. Nobody
including us can read it back; asking for another revokes the first, which is
the only revocation anybody actually needs. It is held in memory in the browser
and never written to storage, and the interface test asserts that.

### What it costs to be honest about it

The league is advertised on the front page rather than hidden in documentation.
The people who would write a bot are exactly the people worth having here — a
university teaching analytics has a term's project sitting in `BOTS.md`, and it
runs against a real economy with real opponents rather than a toy.

The reference bot is deliberately plain: price a little under what the market
thinks the product is worth, build what you expect to sell, spend steadily on
both kinds of research, add capacity only when you keep selling out. Against the
built-in archetypes over eighty league games it wins 63% and makes a median
$220,370, which is a respectable floor and an obvious thing to beat. Every
sentence in this section is testable and `test/league.mjs` tests the ones that
matter: that a key gets you into the league and nowhere else, that league
results never move a human rating or reach the human board, that the rate limit
is per key, that grinding does not move the average, and that a table with a
dead program in it still finishes.

## 34. Being findable — the record as something worth money outside the game

A company pays to browse a pool of players, sees a company name and a record,
and can send one thing: an invitation to apply. It never learns who anybody is.
The player decides whether to answer, and answering is what reveals them.

That is a product only if the record is true. Whether it is true is a property
of the game, and therefore measurable rather than arguable.

### Does a number here mean anything about a person

Twelve policies, 500 real ranked tables, each policy's *true* skill defined as
what it averaged over every game it played. Then: how much of that does a short
record recover? (Spearman against the truth.)

| games seen | average made | best single game | win rate |
|---|---|---|---|
| 1 | 0.80 | 0.80 | 0.52 |
| 5 | 0.92 | 0.89 | 0.80 |
| 10 | 0.95 | 0.89 | 0.86 |
| 40 | 0.98 | **0.90** | 0.91 |

Sorting a player into thirds is right 88% of the time after ten games. The
signal is real.

### The number the leaderboard shows is the wrong one to sell

A recruiter never asks "is this person better than someone who has never thought
about it". They ask "is this one of the strong ones", which means telling the top
of the distribution apart from itself. Among the top five players only:

| games seen | average made | best single game |
|---|---|---|
| 1 | 0.25 | 0.25 |
| 10 | 0.67 | 0.45 |
| 40 | 0.87 | **0.21** |
| 80 | 0.91 | **0.14** |

**Best-single-game gets worse the more somebody plays.** With enough attempts
everyone's best game is their luckiest one, so among strong players it converges
on who played the most tables. The public leaderboard is a fine *game* mechanic
— it is winnable this afternoon, which is the point of it — and it is the worst
statistic on the site for saying anything about a person. The profile is built
from the average and the game count instead.

### What a customer actually experiences

Correlation is an abstraction. Invite the three who look best out of twelve:

| games on record | truly top 3 | at least above average | a genuine dud |
|---|---|---|---|
| 1 | 61% | 93% | **0%** |
| 5 | 77% | 99% | **0%** |
| 10 | 83% | 100% | **0%** |
| 40 | 94% | 100% | **0%** |

The failure that would end the business — inviting somebody who turns out to be
hopeless — does not happen, even on a one-game record. What a thin record costs
is only the fine ordering among the good ones. An invitation to apply is a
low-stakes action that has to clear "worth a conversation", and it does. **Five
games is the floor** for appearing at all, and the game count travels with every
number so nobody has to take the floor on trust.

### Which traits may be published

A profile that says *how* somebody plays is worth more than one that says how
much they made — and most of the candidates do not survive being checked. Asking
how many games before a trait sits within 10% of its own long-run value:

| trait | 1 game | 5 | 10 | 20 | published |
|---|---|---|---|---|---|
| price index | 91% | 100% | 100% | 100% | yes, immediately |
| quality index | 96% | 100% | 100% | 100% | yes, immediately |
| stock-out rate | 33% | 66% | 80% | 89% | at ten games |
| advertising | 24% | 20% | 31% | 44% | **never** |
| borrowing | 10% | 21% | 31% | 40% | **never** |
| margin | 8% | 15% | 23% | 29% | **never** |

The last three are ratios with small, noisy denominators. They are stored,
because storing them is free and they are useful in aggregate, and they are
never shown: a number still wrong more often than not after twenty games is not
a fact about a person. The profile **names what it is withholding**, so nobody
has to wonder whether it was considered.

Every figure is measured against the rest of that particular table. "Charged
$1,240" means nothing across markets and shocks; "4% under the room" means the
same thing everywhere, which is what makes an average over games legitimate.

### Sourcing, not selection

This distinction is the one that matters legally rather than technically, and it
was the deciding factor in the design.

An invitation to apply is the same object as a recruiter's approach on any
professional network. A score handed to an employer to screen candidates with is
an **employment selection procedure**, and in the US that engages EEOC selection
guidelines and, in New York City, a bias-audit requirement — obligations that
attach to the tool as well as to the employer using it. So: nothing here ranks a
shortlist for a customer, the profile shows a percentile rather than a rank, and
nothing should be added that changes that. (Not legal advice; this needs a
lawyer before anything is sold.)

### The refusals, and why each one is where it is

Almost the whole of `lib/talent.mjs` is refusals.

**Nobody is in the pool who did not ask.** Opted *in*, explicitly, with a date
recorded. Revoking sets the date rather than deleting the row, so "did they ever
consent, and when" stays answerable.

**Nobody under eighteen is in the pool at all** — not "cannot be hired", cannot
be *seen*. The harm is not the job application, it is being placed in a database
that adults browse and target, and a sixteen-year-old can and does apply for
jobs. Enforced at the pool, at the profile and at the invitation, because a rule
that matters should not be enforced in only one place. (The classroom tier is
excluded for free: a student joins a class without an account, and class games
are never scored into results at all.)

**Nothing is shown to a company that is not shown to the player.** The same
function builds both, and `test/talent.mjs` asserts the two objects are equal
rather than merely similar. A profile somebody cannot see is a profile they
cannot correct.

**The invitation has no free text.** A fixed object — company, role, link, and a
generated line saying why this player — has no harassment vector, no spam
vector, and nothing to moderate.

### What is deliberately not built yet

The company-facing side: browsing, paying, sending. It is the last piece, not
the first, because it needs a population and there is not one yet. Everything
above accumulates that population from the first sign-up, and none of it is
wasted if the company side is never built — the profile is a good thing for a
player to have on its own.

### A bug the screen found

The opt-in form posted two empty strings. Reading the inputs inside `guard()`
meant reading them *after* the busy flag had re-rendered the page and replaced
them, so whatever the player typed was silently discarded and the confirmation
repeated nothing back. The rest of the client already read inputs before calling
`guard()`; this was the one place that did not, and only the browser test caught
it — because at the API level the request was perfectly well-formed.

## 35. When it goes wrong, do they keep going?

The most valuable thing a profile could say about somebody, and the one where
the strongest statistic turned out to be the one that must not be published.

A setback is identifiable from what is already stored: a round that **lost money
and left them in the bottom half** of the table. Losing money while leading is an
investment; losing money while last is trouble. Every game contains some — 4.6 on
average — so this is a measure that fires rather than one that merely sounds
good.

### It is there, and it is the fastest signal on the site

Players identical in every respect except how often they walk away after a bad
round:

| quit chance | setbacks faced | kept filing afterwards |
|---|---|---|
| 0% | 808 | **100%** |
| 25% | 868 | 47% |
| 50% | 917 | 18% |
| 85% | 917 | 5% |

**Three games** separate a persister from a quarter-of-the-time quitter with 97%
reliability; five gives 99%. For comparison, telling two *strong* players apart
on skill took forty. And it is almost untouched by ability — the same quit
behaviour given to a strong and a weak player reads within 5–6 points.

### And it is the one thing that must never be sold

In a five-minute-a-round game, "stopped filing" means a meeting started, a
battery died, or a child woke up. Publishing that as character would be wrong
about individual people, and — worse, because it is systematic — it would rank
players by how much **uninterrupted time** they have. That is precisely the
mechanism by which a hiring signal acquires a disparate impact on carers, shift
workers and anybody playing on a phone between other obligations.

So the strongest number measured on this project is computed, stored, and shown
to nobody. The profile lists it among what it is withholding, with that reason
attached, because a profile that quietly omits things is one nobody can argue
with.

### The fair version, and two wrong turns getting there

Restrict to bad rounds the player was **demonstrably present for** — they filed
the following round — and ask whether they changed what they were doing.

**Wrong turn one: comparing with their own last price.** A player filing one
fixed rule scored as "changed tack" **89% of the time**, higher than a genuine
adapter. The natural price moves every round on its own as quality grows and
products age, so the detector was measuring the market rather than the decision.
Measuring the player's position *relative to the room* fixes it:

| player | moved after a bad round |
|---|---|
| changes tack when hurt | 68% |
| files the same rule regardless | 47% |

Ten games gets this to 94% reliability — weaker and slower than the abandonment
signal, and fair. It is unaffected by absence: a player missing 40% of rounds at
random still reads 75%, because missed rounds are skipped rather than counted
against them.

It is also not skill wearing a hat, which is the test that killed most of the
candidates. Giving the same behaviour to a strong and a weak player:

| ability | changes tack | files the same rule | gap |
|---|---|---|---|
| strong | 69% | 52% | 17 points |
| weak | 64% | 47% | 17 points |

The behaviour moves it 17 points; ability moves it 5.

**Wrong turn two: assuming it was a virtue.** Five different responses to a bad
round, same player otherwise, 250 tables each:

| response after a bad round | median made | in profit | won |
|---|---|---|---|
| does nothing different | −$39,397 | 42% | 21% |
| cuts price a little | −$30,790 | 43% | 20% |
| cuts price hard | −$46,457 | 40% | 18% |
| spends on advertising | −$37,944 | 42% | 19% |
| cuts price and advertises | −$44,023 | 41% | 18% |

All five within $16,000 of each other. Doing nothing different is middle of the
pack; cutting price hard is the worst of them. **Responding to a setback does not
predict what you finish with.**

So the line on the profile is a description of temperament, not a score, it is
worded that way, and it carries the finding with it — "neither way is better" is
printed next to the number rather than left for somebody to assume. Nothing
ranks on it.

### Two kinds of withholding

The profile now distinguishes them, because conflating them would hide the
important one.

**Too noisy to be a fact.** Advertising, borrowing and margin are still wrong
more often than not after twenty games. That is a measurement problem, and more
data would fix it.

**Not ours to infer.** Whether somebody finished, or missed rounds. More data
would not fix that; it would sharpen a number that should not exist. It is the
only entry in the second category, and it is the one worth having a category
for.

## 36. Does anybody actually get better at this?

Every player-facing claim rests on it — that the game teaches something, that a
record means anything, that a fifth game is worth playing after a disappointing
first one. It has never been measured and could not be: every measurement in
this document used simulated policies, and a simulated player learns nothing
because it was born knowing. Only people can answer it. So the arithmetic is
built and waiting for them, and it was built now rather than later because the
data it needs is generated the moment players arrive and cannot be recovered
afterwards.

The whole difficulty is that the obvious way to measure it lies.

### The naive curve rises even when nobody learns

Plot "median money made at game 1, at game 2, at game 5". It will go up. It will
go up even if not one person improved, because the people still playing at game
five are not the people who played game one — somebody whose first game went
badly is likelier to leave, so every later point is measured on a population
that has quietly had its worst members removed.

`test/progress.mjs` builds exactly that world: fixed skill, nobody improves at
all, and a player whose first game loses money quits with probability 0.45 a
round instead of 0.08.

| | median made | players |
|---|---|---|
| game 1 | $7,682 | 400 |
| game 2 | $31,217 | 291 |
| game 3 | $48,991 | 224 |
| game 5 | $50,700 | 167 |

Read straight, that is **$43,018 of improvement** in a world with none. It is not
a subtle effect and it is the number anybody would have shipped.

### Holding the population still, then shuffling

**Matching.** Take only players who reached game *n* and compare *those same
people's* first game with their own *n*th. The same people at both ends, so
nothing can be improved by leaving. On the fake population above this reports
**−$62,435** rather than +$43,018 — a survivorship effect of **$105,453**, which
is reported next to the answer because it is the most interesting number there.

**A permutation null.** Matching fixes who is measured, not whether the order
matters. So each player's own games are shuffled into a random order and the
whole thing recomputed, two hundred times. If the real ordering does not stand
outside the reshuffles, there is no learning — only variance wearing a hat. On
the fake population the real ordering lands at the 0th percentile. On a
population where players truly gain $26,000 a game it lands at the 100th, with
reshuffles falling between −$27,329 and $26,378.

### The residual bias, and why it is left alone

Building the fake population exposed a second problem that reasoning had missed.
If leaving depends on the first game, then everybody who reached game five had
an unusually good first game — that is *why* they are still here — so measuring
from it starts the comparison too high. In the world where players truly gained
$26,000 a game, this recovers **$53,706 of a true $104,000**.

It understates by about half, and that is left alone deliberately, because it is
the right direction to be wrong in:

- **a positive result can be believed** — it is a floor, not a ceiling
- **a null result is not proof that nobody learned**

Both sentences are printed with the answer rather than left in a comment. The
test asserts the direction of the bias rather than hoping for it: an estimator
that overstated would be one whose positive results were worthless.

### Where it lives

`GET /api/learning` is public and anonymous — it is an aggregate over everybody
and names nobody, and a claim about whether the game teaches anything ought to
be checkable by the people being asked to believe it. It answers *not enough data
yet*, with the count, until twenty players have reached five games.

A player also sees their own first games against their last, as a sparkline on
their record. It sits *outside* the profile object rather than inside it: the
rule is one-directional — a company never sees anything the player is not also
shown, but the player may be shown more — and somebody's own history with the
game is nobody else's business. The browser test asserts it cannot reach the
profile a company would be handed, and the page says in plain words that a dozen
games cannot tell you whether it is you improving or the tables being kind.

## 37. Unbundling the charter, and the hiring side

Two changes that arrived together and pull in opposite directions: one makes the
product cheaper to start with, the other is the first thing here sold to
somebody other than a player.

### The charter was two products in a coat

It bought a company name kept for good *and* the ability to host private games.
Those are different things — one is an identity you keep, the other is something
you do — and bundling them meant anybody who only wanted to be called something
had to buy a feature they had no use for. They are now separate purchases:
**Company name** at $19.99, **Private games** as its own.

Three things fall out of that, and two of them are refusals.

**Nobody who already paid loses anything.** Everyone holding the old `host`
entitlement bought it when it meant both, so stage 9 of the schema grants them
the `name` entitlement the split separated out. Unbundling would otherwise
quietly take something away from the people who paid first, which is the worst
imaginable group to take something from. The migration is idempotent and the
test asserts that running it twice leaves two rows rather than three.

**Hosting with no name is refused before any money moves.** A private game is
created *under* a company, so hosting without one is a purchase that cannot be
used — and finding that out on the far side of a payment page is the worst
possible moment. Checked in `startCheckout`, not at the point of use.

**Buying the same thing twice is refused**, which sounds obvious and was not
true of the old code.

An observation that shaped none of this but is worth recording: at the moment
the split was built, **there had been no private games at all in a week**.
Hosting is the least-used thing on the site, and it now has a price on it. That
may well be the wrong order — the argument for doing it anyway is that the
plumbing is easier to build before there are customers than after.

### The hiring side, and what it refuses to do

A company pays for access, browses players who asked to be found, and sends one
thing: an invitation to apply for a named job. `lib/recruit.mjs` is almost
entirely a list of things a paying customer may not do.

**They see a record, never a person.** The profile handed to a recruiter is
built by the same function that builds the player's own, so there is no second
code path down which a field could leak. `test/recruit.mjs` asserts that no
email, no account id and no name of a person appears anywhere in the payload.

**One approach per player, for ever.** Not per week. A company that has been
ignored once does not get to ask again, and a unique index on
`(recruiter, company_id)` enforces it rather than good manners — two requests in
the same instant cannot both win.

**Twenty invitations a day.** Enough to work a shortlist, not enough to mail the
pool and see who bites. The property that makes an invitation worth opening is
that it is not spam, and that has to be defended *from the people paying us*.

**Nothing ranks the pool.** It comes back newest-first with a percentile on each
profile and no sort control. The order a customer is handed a list in is itself
a recommendation, and a ranked shortlist handed to an employer is a selection
procedure under a different body of law. An invitation to apply is sourcing. See
§34.

**Eligibility is re-checked at the moment of sending.** Somebody may have taken
themselves off the list between the browse and the send, so a company id kept
from an earlier page is worth nothing — asserted directly in the test.

**The player is anonymous; the employer is not.** Only one side of this needs
protecting. An invitation from nobody in particular is worthless to receive and
sinister to get, so the employer's name is required and travels with it. That is
the one place free-ish text exists, and it is a fact about the employer rather
than a message to a person.

### What the player gets

Invitations appear on their own record, above their own numbers, each carrying
the sentence explaining why it was sent. Dismissing one is a single press. There
is no reply button: applying happens on the employer's own site, so we are the
introduction and not the middle of a conversation — which is also why there is
nothing here for anybody to moderate.

### The honest state of it

The pool is empty. Seventeen people played in the week this was written and
none of them had opted in. Everything above is a mechanism waiting for a
population, built now because the rules are far easier to get right before
anybody is relying on them than after.

## 38. Negotiating with somebody — supplier contracts

An investor asked whether the player ever negotiates with anyone: for raw
materials, for space, for a raise. It is a fair question about a game whose
whole surface is seven numbers a round.

The honest answer for two of the three was that the lever already exists under a
different name. Leasing more space is `targetCapacity` — you set the size of
the plant and pay upkeep on it. Paying people better to get more out of them is
process R&D — you spend, and throughput and unit cost both improve on a delay. A
second control doing the same arithmetic would make the screen longer without
making the decision harder, and the screen is already the constraint.

Raw materials were the one real gap. The cost shock track moves input prices —
a supplier fire at 1.35× for two rounds, tariffs at 1.20× for three, a glut at
0.85× — and until now a player had no answer to it except to build less. Input
costs are 33% of a company's costs, measured, and a season that meets a cost
shock ends about $47,000 poorer than one that does not.

### The mechanic

Three numbers make a contract: units a round you commit to, how many rounds, and
the rate the supplier locks. The player chooses the first two. The third comes
off a curve, and the curve is the negotiation.

**Volume improves the rate. Term worsens it.** Commit more and the supplier pays
you for certainty of volume; commit for longer and they charge you for carrying
your price risk further into the season. The two levers pull against each other,
which is the only reason there is a decision here rather than a slider everyone
pushes to the same end.

**The lock is a multiplier on the market, not a dollar price.** Your own
learning and your own process R&D still bring the cost of a unit down
underneath it. Locking a dollar figure would mean the contract turns bad
precisely because the player got better at manufacturing, which teaches the
opposite of the intended lesson.

**It settles in cash, after the engine, never inside it.** Two reasons. The
engine is generated from a source file outside this repository and shared
byte-identical with the single-player game, so multiplayer must not diverge from
it. And unit cost is booked into inventory: rewrite it after the fact and stock
on hand stops matching what was paid for it, which surfaces three rounds later
as profit from nowhere. A cash settlement is also what a real hedge does. There
is a test that plays two identical seasons and asserts the book value of
inventory is identical to the cent.

**Take-or-pay, at a deficiency rate.** You pay for committed volume whether you
use it or not — otherwise the contract is a free option and the rate would have
to price it as one. But a unit you did not take costs 40% of the locked rate,
not 100%. That single number was the difference between a hedge and a trap; see
below.

### Three calibrations, two of them wrong

**First attempt — the coupon.** The volume discount arrived fast: a contract
sized to your own production locked at 0.95 against a market averaging 1.039.
Over 400 matched seasons it beat never signing by $23,549, went bankrupt *less*
often than not signing, and had a better worst tenth. Every one of those is a
good number and together they are a failure: a lever everybody should pull
without thinking is not a decision, it is a tax on players who have not read the
manual.

**Second attempt — the trap.** The curve was flattened until the lock sat above
the long-run market average, which is what insurance should cost. Now every
setting lost money on the median — expected, and fine — but the *worst tenth of
seasons got worse too*, at every volume and every term. A hedge that deepens the
bad tail is a bet wearing an insurance label.

The cause was take-or-pay at full price. A commitment sized to a season's
production goes unmet in 13% of rounds — a capacity shock, a slump, one round of
over-stock — and at full price those rounds cost more than every cost spike the
contract was protecting against. A real take-or-pay clause charges a deficiency
fee for the supplier's lost margin, not the invoice for goods never made.
Charging 40% is both the right economics and the fix.

Two other things were wrong and worth recording. The supplier was quoting
against last round's *sales* while the player buys against *production*, and the
two differ by about 40% in a growing company — so "one times your throughput"
silently meant seven tenths of what was actually being bought, a number nobody
could reason about from the screen. And the term was a discount rather than a
premium, which made the longest contract strictly correct at every volume.

**Third attempt.** Base rate swept from 0.99 to 1.09 over 300 matched seasons a
step. Below about 1.02 every modest contract simply pays. Above about 1.06
nothing on the curve is worth signing. 1.04 is the band where it works.

### What it does now — 800 matched seasons

Every arm plays the identical seeded season with identical trading against
identical opponents. The contract is the only thing that differs, so the paired
difference is caused by the contract and nothing else.

| commitment | median vs not signing | worst tenth | bankrupt |
|---|---|---|---|
| none | — | -$28,079 | 4% |
| 0.6× for 3 rounds | -$1,487 | **-$21,550** | 3% |
| 0.8× for 5 rounds | -$3,217 | **-$16,477** | 3% |
| 1.0× for 5 rounds | -$2,411 | **-$16,782** | 3% |
| 1.5× for 5 rounds | -$27,801 | -$99,555 | 8% |
| 2.0× for 5 rounds | -$81,638 | -$213,311 | 20% |
| 3.0× for 5 rounds | -$241,086 | -$255,933 | 59% |

A contract sized at or below your own production costs a few thousand on the
median and takes **$11,000 off the worst tenth of seasons**. That is what a
hedge is: give up a little expectation, cut the tail. Above about 1.2× it
inverts, and at 3× it is ruin in nineteen seasons out of twenty.

Nothing dominates. The best setting for money (0.8× for 8 rounds, +$2,011) is
not the safest (0.8× for 5, 3% bankrupt), and the setting with the best tail is
neither.

### The part that makes it a skill

Volume and term are a shape to learn. Timing is the thing worth reading the
screen for.

| when the same contract is signed | median gain |
|---|---|
| round 0, blind | -$2,411 |
| while a cost shock is running | **+$12,929** |
| while costs are calm | -$2,867 |
| every time one expires | +$2,520 |

Cost shocks last two or three rounds and are announced in the headlines. Signing
while one is running captures the remainder of it; signing blind in round 0 does
not. The same 1.0×/5 contract is worth **+$18,748** in a season that meets a
cost spike and **-$5,851** in one that does not — so the headline is not
narration any more, it is information with a price on it.

That was the fourth thing this had to prove, and the one it would have been
easiest to fail: the right answer has to depend on something visible. It does.

### What is not built yet

The server side is complete and tested — 24 logic tests including a full
seeded-season run, and the API accepts a contract in the same request as the
orders. **The player-facing interface is not built.** A contract can be signed
over the API today and not from the page, which means the mechanic exists and
nobody can reach it.

That is deliberate ordering rather than an omission: the calibration above
changed the numbers three times, and building a screen against the first two
would have been building it twice. It is the next piece of work.

The measurement harness is `test/contractsim.mjs` and runs in about twenty
seconds: `npm run measure:contracts`.

## 39. Renting plant, in both directions

The same question as §38, asked about capacity rather than materials: when you
change the size of the factory, should there be a choice about *how*?

There is a real gap here, and it is worth being precise about it, because the
first answer given to the investor who asked about leasing was that it duplicated
`targetCapacity`. For leasing space in the abstract, that was right. For
buy-versus-rent it is wrong, and the difference is the word *temporary*.

Capacity in this game has only ever been permanent. Buy at $18 a unit and it
arrives a round later; sell and recover $7.20 — a 60% haircut the moment you
change your mind. Work out what temporary plant costs and the gap is obvious:

| how long you keep a unit | total cost | per round |
|---|---|---|
| 2 rounds, then sold | $20.80 | **$10.40** |
| 5 rounds, then sold | $35.80 | $7.16 |
| 10 rounds, then sold | $60.80 | $6.08 |

Owning is cheap if you keep it and brutal if you do not. The game already
punishes temporary capacity; it simply offered no alternative to being punished.

### What was added

Two leases, both running exactly two rounds and then ending on their own — the
term the request specified, and the right one: a supply crunch is two rounds and
a logistics strike is two.

**Renting in** costs $4.50 a unit a round on top of the $5 running cost you pay
on any plant you operate. All in that is $9.50 against $10.40 for buying and
dumping over the same two rounds. It is available *in the round you ask for it*,
which is the whole point — bought capacity takes a round to arrive and a spike
does not wait.

**Renting out** pays $4.00 a unit a round and you stop paying to run it. You keep
the asset. You cannot have it back for two rounds.

Leased units are never held inside `p.capacity`. They are folded in for the
length of one `resolve()` call and folded straight back out, which keeps the
engine untouched and keeps `targetCapacity` meaning what it always meant: the
plant you own. Build and sell orders are computed before the fold, so a player
cannot accidentally sell a factory they are renting. There is a test that does
exactly that and checks the owned plant to the unit.

### The boundary with buying, which is the whole design

The danger with this feature is not that it is weak, it is that it is strong.
Renting is available this round and buying is not, so if the rent is priced even
slightly low, renting becomes the answer to everything and the capital lever the
game already has stops mattering.

400 matched seasons, identical market, identical trading, identical opponents:

| the need | answered by | median | worst tenth |
|---|---|---|---|
| a short squeeze | **renting** | **$311,413** | **-$11,464** |
| | buying | $298,425 | -$34,890 |
| a permanently bigger company | renting, renewed | $243,895 | -$200,419 |
| | **buying, once** | **$286,784** | -$166,126 |

Renting wins the short need and loses the permanent one by $43,000. The boundary
falls exactly where the lease term ends, which is what the price was set to do.

### Renting in is the strong half

| when the player rents in | worth, in seasons it fires | worst tenth | bankrupt |
|---|---|---|---|
| never | — | -$50,207 | 4% |
| blindly, every chance | **-$63,505** | -$200,419 | **16%** |
| when short of plant | +$21,019 | -$11,464 | 2% |
| **while a supply crunch is running** | **+$37,722** | **+$470** | 3% |

The best rule is keyed to an announced shock — a port strike, hauliers walking
out — and it is worth $37,722 with a *better* bad tail than not renting at all
and a lower bankruptcy rate. Doing the same thing without reading the headlines
costs $63,505 and bankrupts one company in six. That spread is the lever.

### Renting out is the weak half, and this says so

| when the player rents out | worth, in seasons it fires | units sold | bankrupt |
|---|---|---|---|
| never | — | 17,365 | 4% |
| blindly, every chance | **-$429,787** | **12,403** | **53%** |
| when the plant sits idle | -$28,709 | 16,611 | 6% |
| idle *and* a slump announced | +$5,484 | 17,251 | 3% |

The best rule anybody could find is worth $5,484, which is close enough to
nothing to say so plainly. Renting the factory out blindly is one of the fastest
ways to die in this game: sales collapse 29%, and more than half the companies
that try it go under.

Units sold is the column that matters, and finding that out took two wrong
metrics. Stockouts read zero in every arm — in a shared market the spill caps
each company's allocation by what it can supply before the engine sees it, so
`lostSales` is structurally near zero in multiplayer. Market share then read flat
in every arm for a different reason: share is the slice of demand your price and
quality win, and renting the factory out changes neither. What changes is how
much of that demand you can supply, and the spill hands the rest to whoever has
stock. The demand does not wait and it does not come back.

### Two things this got wrong on the way

**A money pump.** The sweep suggested $5.00 for renting out against $4.50 for
renting in. Rented-in plant pays the running cost and rented-out plant does not,
so the upkeep cancels exactly and the gap between the rates is pure profit per
unit cycled. A company with two lines could rent capacity out of one and into the
other, hold exactly the same total plant, and be paid fifty cents a unit a round
for it. Renting out is now $4.00, and there is a test asserting the spread.

**Renting out beats selling, and that is not being corrected.** Both stop the
running cost, so selling is $7.20 once against $4.00 every round the plant is
out. Answering an idle line by selling it down is worth -$278,290; renting it out
is worth -$28,709. That was not the intention. It is right: a 60% haircut is a
fire-sale price and a fire-sale ought to lose to renting. What it means is that
selling plant now answers a narrower question — when the cash is needed now, or
the line is being abandoned — rather than being the only way to shrink.

### What is not built yet

As with §38, the server side is complete and tested and **the player-facing
interface is not**. Leases can be signed over the API and not from the page.

There is one extra wrinkle here worth recording before that screen is built:
rented plant is available in the round it is signed for, so the production field
has to allow a number above the line's current effective capacity in the same
breath as the lease. A screen that clamps production to owned capacity would let
a player pay rent for plant they cannot use, which is the worst of both.

Measurement harness: `npm run measure:leases`, about twenty seconds.

## 40. Is there a second game here?

An investor's follow-up to §38 and §39, and a better question than the one that
prompted them: an instructor with a fifteen-week semester could run this twice —
once early, once later with more to think about. Do supply contracts and leases
make the second sitting a real step up?

There is an easy wrong answer available: count the levers, observe there are
more of them, declare it advanced. More decisions is not a different lesson. If
the students who do well in the first game are exactly the students who do well
in the second, an instructor works that out by week ten and never buys the
second licence.

### The test, and the first version of it that was wrong

The right question is whether the new decisions are *orthogonal* to the old ones.
Eight distinct ways of playing, 300 seeded seasons each, ranked with the extras
off and again with them on.

The first version ranked every player with the same competence at the new levers
and reported a rank correlation of **1.00** — nobody overtook anybody, apparently
conclusive evidence that this is the same game with more typing. That number was
an artefact of the design. If everyone handles the new decisions equally well,
the new decisions cannot change who wins. It is not a classroom.

Crossing the two — every base style against every level of competence at the
extras — gives the answer that means something:

| | |
|---|---|
| Pairs where one base style beats another outright | 28 |
| Weaker style overtakes by handling the extras well, while the stronger pulls them blind | **32%** |
| ...while the stronger simply never touches them | 14% |

A player who prices badly and reads the news beats a player who prices well and
does not. That is a second lesson.

The same trap appeared in the second reading. Correlation between how good a
player already was and what the extras are worth to them came out at **0.85**,
which reads as "a multiplier on the first lesson". Across only the six styles
that are not usually bankrupt it is **0.05**. The 0.85 was survivorship: a style
that goes under in nine seasons out of ten cannot benefit from anything, and
including it measures survival rather than skill.

As a share of what each player was already making, the extras are worth 19% to
the premium player, 33% to the one who undercuts a little, and 69% to the one who
undercuts hard. Not monotonic in skill at all.

### How big is it

| | |
|---|---|
| Base decisions, best style to worst | $588,478 |
| ...counting only styles that usually survive | $218,246 |
| Handling contracts and leases well against badly | **$97,755** |

45% of what the base game teaches, among players who are actually playing it.
That is material. It is not transformational.

### The finding that matters more

A second sitting is a step up in two directions, and only one of them is the one
that was asked about. The other is what the *first* sitting could leave out.

The base game already asks for seven numbers per product line plus whether to
open another. Hide two of them — process research and launching — from a first
sitting and the spread between best and worst falls from $588,478 to $297,743.

**Those two levers are worth $290,735 of separation on their own, three times
what the supply contract and the leases add together.**

And the reason is worth stating, because it is an argument about teaching rather
than arithmetic: the single most self-destructive thing available to a beginner
in this game is over-investing in process research. The style that does it goes
bankrupt in 91% of seasons. A first game in which a student can destroy their
company nine times out of ten by over-using an abstract lever they have not been
taught yet is a bad first game, and hiding it is a better decision than any
amount of adding.

### What this says the two levels should be

Not "the game, and the game plus negotiations". That undersells the first sitting
by making it the same thing with pieces missing, and oversells the second by
resting it on $97,755 of new decision-value.

**First sitting — five decisions a line.** Price, how much to build, advertising,
quality research, plant size. One product, no launching, no process research, no
contracts, no leases. This is a game about matching supply to demand at a price,
and it can be taught in ten minutes and played in fifty.

**Second sitting — everything.** Process research and launching, which is where
most of the separation lives and where a beginner can hurt themselves. Contracts
and leases, which add an axis the first game does not test at all: the headlines
stop being narration and start carrying a price.

That is a genuine step up, and the honest split of it is roughly three parts
existing complexity revealed to one part new mechanics.

### What has not been measured

Round time. A second-level round asks for more, and rounds run on a clock as
short as forty-five seconds. Whether the extra decisions fit is a question about
an interface that does not exist yet, and no simulation here can answer it.

The gating itself does not exist either. Hiding levers per level is not built —
today every game shows everything. That is a host-facing setting and a
view-shaping change, and on this evidence it is worth more than either of the
last two features.

Harness: `npm run measure:levels`.

## 41. Building the levels

§40 measured which levers to hide. This is what was built.

Two levels, and level 2 is the default, so every game and every class that
existed before this keeps behaving exactly as it did. An unrecognised level falls
back to it rather than inventing one.

| | Level 1 — First game | Level 2 — The full game |
|---|---|---|
| Price, units, advertising, product R&D, plant size | yes | yes |
| Process R&D | **no** | yes |
| Opening another product line | **no** | yes |
| Discontinuing a line | **no** | yes |
| Supply contracts (§38) | **no** | yes |
| Leasing plant (§39) | **no** | yes |

Five controls a line instead of six, and three whole cards gone from the orders
screen.

### One place that answers "is this lever on?"

`rulesOf(game)` returns the level's rules, and every check goes through it.
Repeating the condition in six places is how two of them end up disagreeing after
someone edits one.

### Refused, or quietly zeroed — and why they differ

The two are not the same and the distinction is deliberate.

**Launching, signing a contract, taking a lease are refused**, with a message
saying what they are. These are things a person does on purpose; failing silently
would leave somebody staring at a screen wondering why nothing happened.

**Process research and discontinuing are zeroed.** They are numbers on a form
rather than deliberate acts, and a standing order filed before a host changed the
level should keep working, not start failing every round for the rest of the
season. A number that is not on the screen is simply not spent.

### The three ways it could have failed

**The page is not a permission.** Every hidden lever is sent to the server anyway
in `test/levelgate.mjs`, every round of a full season. A control disappearing
from the interface proves nothing about what the API accepts.

**The archetypes play by the same rules.** This is the one that would have been
worst. A bot quietly spending on process research in a game where the control is
not on the screen would beat players with a lever they cannot reach, and nothing
would look broken — one company would just be inexplicably cheaper all game, with
no explanation available to the instructor. `botDecideFor`'s plan is zeroed and
`botShouldLaunch` is not consulted at all. The test asserts that no line in a
level-1 game finishes above 100 efficiency, players and bots alike.

**Standing orders are re-read, not replayed.** `ordersFor` puts the repeat back
through `normaliseDecisions` against the current rules. Without that, a host who
dropped the level mid-season would leave every unattended player still buying
something the game no longer offers, invisibly, until the end.

### Where the level is not a choice

Ranked tables and the bot league are pinned to level 2. The leaderboard is one
pool and one record; a table with half the levers switched off, scored against
tables that had all of them, would produce a number that means nothing. The bot
league is pinned for a different reason — a documented API against a smaller rule
set is a second protocol to keep in step.

Private games and classes both pick. The class form defaults to **level 1**,
because a class is where a first sitting actually happens; the private game form
defaults to the full game, because that is what it has always been.

### Two tests that passed for the wrong reason

Worth recording, because both looked green.

The first counted process-research spend out of the engine's per-product log to
prove none was charged. The log carries `rd` and not `rdProcess`, so it read zero
whether the gate worked or not. Rewritten to measure efficiency, which is the
only thing process research moves.

The second checked that a standing order stopped buying process research after a
level change — but it spent $60,000 a round, and the company was bankrupt by
round five. Nothing repeats after that, so the test was asserting against a dead
company. Rewritten with a survivable spend, a forgiving credit line, and an
explicit check that the company is still alive before the level is changed.

### What is still not built

The supply contracts and the leases still have no interface, so level 2's two new
mechanics remain reachable only over the API. The gating knows about them and
hides them correctly at level 1; there is simply nothing to show at level 2 yet.

That is now the single largest gap in the product, and it is the only thing
between here and a second sitting an instructor could actually run.

## 42. The interface for contracts and leases

§38 and §39 built two mechanics and left them reachable only over the API. This
closes that, and the interesting part is not the controls.

### The rate curve as a grid you click

The supply contract has three numbers and two of them pull against each other:
volume improves the rate, term worsens it. Three named deals would have hidden
that — somebody would have had to reverse-engineer the shape from a menu.

So the whole curve is on screen as a table: terms down the side, volumes across
the top, the locked rate in each cell, and you click the cell you want. The
trade-off is legible at a glance because it *is* the layout — better rightwards,
worse downwards.

Every rate in that grid came from the server. The page does not know the curve
and cannot recompute it, so there is no second copy of the pricing to drift.

### Leasing sits inside the line, not in a card of its own

Capacity belongs to a product line, and the decision leasing competes with —
building or selling plant — is the control immediately above it. Buying is
permanent and arrives next round; renting is temporary and arrives now. Putting
them next to each other is the whole point of having both.

One direction per line at a time. When a lease is pending the two inputs are
replaced by what was chosen and a way to take it back, so the form cannot build a
request the server would refuse. Validating after the fact would have been the
easier thing and the worse one.

### The wrinkle §39 flagged, closed

Rented plant is available in the round it is signed for. A production field
clamped to owned capacity would therefore let somebody pay rent for plant the
form will not let them use — the worst of both. The slider's ceiling now runs
through the same helper the projection uses, so renting in raises it and renting
out lowers it, and there is a browser test that renting out shrinks it.

### The part that needed a test rather than a decision

The projection panel runs the real engine in the page against the orders being
typed. That it is the same arithmetic rather than a reimplementation is the
strongest claim this product makes about itself, and it is true because the
economy file is inlined into all three places byte-identical.

Contracts and leases break that once. Their settlement lives in
`lib/contracts.mjs` and `lib/capacity.mjs`, which the page cannot import, so the
page now holds a second copy of those sums. There was no way around it worth
having: the alternative was to leave the panel silent about a settlement worth
tens of thousands, which would make the number a player is shown not the number
they get.

So `test/supplyui.mjs` is the guard. It signs a contract at the best rate on the
board, takes a lease, reads what the page predicts, lets the round resolve, and
compares. Both branches of the settlement are covered — the ordinary one, and the
shortfall, which has two terms and a constant the page only knows because the
server sends it. Current drift: **$0 on both**.

That constant is worth noting. `SHORTFALL` is sent to the page as
`supply.shortfallRate` rather than written into the template, because a number
copied into an interface is a number that will still be 0.4 after somebody
changes it to 0.3 in the module. The first run of the test caught exactly this
class of problem in a different guise — a dev server still holding the module
from before the field was added, projecting the shortfall as free.

### What the page now does with a level

Level 1 draws none of it: no grid, no lease inputs, and the server sends
`supply: null` and `leasing: null` so there is nothing to leak. `test/levelui.mjs`
asserts both the absence and the presence.

### Still open

Nothing on these two mechanics. The gap that remains is the one §40 named:
whether a level-2 round fits in forty-five seconds now that it asks for more. That
is a question about people rather than arithmetic, and it wants a real cohort
rather than another simulation.

## 43. Would a tournament find the best player?

An investor's question: could somebody buy a licence — around $299 — to run a
tournament? Groups of six, winners advance, a leaderboard inside the event.

Most of that already exists. A class is groups of six playing the same seeded
market with a board over the top. The bracket is the new part, and the bracket is
the part that could quietly be a lottery. §34 already found that a single result
is a weak measure of a player — correlation with ability 0.45 at ten games, 0.21
at forty, 0.14 at eighty — and a knockout is made of nothing but single results.

### Two errors, both of which flattered the product

**The first draw took 36 seats from 12 policies with replacement.** The strongest
policy therefore appeared about three times, and the question being answered was
"does the best strategy win" rather than "does the best player win". It reported
82%.

**The second used deterministic players.** A fixed rule facing a seeded market
varies only as much as the market does; a person misreads a round, gets
interrupted, changes their mind. With no within-player noise the bracket looked
**91% accurate**, which is not a finding about tournaments — it is a finding
about how easy it is to tell two fixed rules apart.

Both are in `test/tourneysim.mjs` with the reasoning, because a number that
flatters you is the one worth being suspicious of.

### What it actually says

Entrants are 36 distinct points on a price × production grid, drawn from the top
half by measured strength — an entry list is people who have played before, and
the closer the field the harder the bracket's job. Each carries a per-round
jitter, and results are reported across a range of it because **how steady a real
player is has never been measured here**. The 20% column below is a guess and is
labelled as one.

Chance, with 36 entrants, is 3%.

| format | best entrant wins | best reaches the final three | tables |
|---|---|---|---|
| Knockout, 1 game a stage | 22% | 53% | 7 |
| Knockout, 3 games a stage | 20% | 56% | 21 |
| Knockout, 2 games, top 2 through | 25% | 64% | 18 |
| **No elimination, 3 tables each** | **28%** | **73%** | 18 |
| **No elimination, 5 tables each** | 27% | **88%** | 30 |

Four things fall out of that.

**A tournament is not a raffle.** Every format beats chance by seven to nine
times. The event means something.

**A knockout crowns the best entrant about one time in four.** Three times in
four the trophy goes to somebody else. That is not a scandal — most sporting
knockouts are worse — but it is not what a $299 licence should be sold as.

**Playing more games inside a knockout does not help.** 22% at seven tables, 20%
at twenty-one. Elimination throws the information away: once you are out, no
amount of further play can correct the mistake. This was the surprise, and it is
the argument against the format rather than for a bigger version of it.

**Ranking on aggregate beats a knockout at the same cost.** 28% against 20% for
the same eighteen tables, and 73% against 56% on the fairer question of whether
the best entrant reached the last three. It also scales: five tables each takes
the top-three figure to 88%, while the knockout stays flat.

### The steady column, and why the draw matters as much as the player

With no jitter at all, knockouts get *worse* — 10% — while aggregate goes *up* to
30–37%. That looks wrong and is not.

With deterministic players the matchup composition dominates. An undercutter
thrives in a room of premium sellers and drowns in a room of undercutters, so the
strongest-on-average entrant can be systematically beaten by a particular group
draw — and a knockout locks that draw in for ever. Aggregate scoring re-draws the
groups every stage and averages over the luck of who you sat with.

**Who you are drawn against matters about as much as how well you play**, and
only one of the two formats does anything about it.

### Swiss pairing makes it worse, which was not expected

The standard answer to ranking a field accurately in few rounds is a Swiss draw:
after the first stage, seat people against others on a similar score. It was
measured and it is **worse** — 71% against 73% on the top-three question at three
tables each, and 77% against 88% at five.

The reason is specific to this game and worth stating, because it is the kind of
thing borrowed wisdom gets wrong. In chess a win is a win whoever you beat, so
concentrating strong players together sharpens the ranking. Here the score is
*money made*, and money made depends on who else is at the table competing for
the same demand. Seat the six strongest people together and they suppress each
other's numbers while a weak group posts large ones. Swiss pairing inverts the
ranking rather than sharpening it.

**A random re-draw every stage is the right answer**, and now for a measured
reason rather than because it was the first thing tried.

### The commercial argument, which points the same way

Thirty-six people pay to attend. A single-elimination bracket sends thirty of
them home after the first hour. Whatever that does for fairness, it is a strange
thing to sell.

### What to build instead

Not a bracket: **a league with a final.**

Everyone plays N tables in re-drawn groups of six. Every group in a stage faces
an identical seeded market, which is the property the whole product rests on and
the only thing that makes tables comparable. The event board ranks on money made
across all of them. The top six play a final.

That is more accurate than a knockout at the same cost, keeps every attendee
playing all afternoon, still produces a champion and a trophy moment, and the
in-event leaderboard the question asked for is no longer a decoration bolted on
the side — it *is* the competition.

It also matches what the rest of the site already decided twice: the bot league
ranks on average money made rather than total, and a player's record is built
from their average rather than their best game, both for the reasons §34
measured.

### What is built

All of it: the pure part, the storage, the API and both screens.

`lib/tournament.mjs` holds the part where being wrong decides who wins — stage
markets, the draw, standings and finalists — and that half is storage-free and
clock-free, like `talent.mjs` and `contracts.mjs`, so it can be argued with in a
test.

Two things in it came out of writing the tests rather than the design. Slicing
groups off in sixes and keeping the remainder produced a **table of two** for
thirteen entrants — the engine will not seat fewer than three, and two people is
not a market. Sizes are now spread evenly, so thirteen is 5 + 4 + 4 and no two
tables in a stage differ by more than one seat. And an entrant who signs up and
never plays a table is excluded from the final rather than taking a seat from
somebody who did.

### Storage: a cohort with stages

Almost nothing new was needed, which is the point of building it on cohorts.
Stage 10 of the schema is three things:

- **`games.stage`**, defaulting to 0. Every class that already exists is stage 0
  and nothing about it changes.
- **The uniqueness widened** from `(cohort_id, group_no)` to
  `(cohort_id, stage, group_no)`. Without that, stage two cannot create a group 1
  because stage one already did.
- **An `entrants` table.** This is the only genuinely new idea. A class needs no
  such thing: a student joins one group and stays in it, so their seat in the
  game is the whole of their identity. A tournament re-draws every stage, so an
  entrant needs a name and a token that outlive any particular table.

**The seat token changes every stage and the entrant never learns.** They hold
one token all afternoon; the console re-seats them under it. The end-to-end test
asserts exactly that — three tables, three different seat tokens, one entrant
token — because it is the thing that would be most annoying to get wrong and
least visible when it was.

### Two rules the storage enforces rather than asks nicely

**The field closes when the first stage is drawn.** Somebody arriving in the
middle would play fewer tables than everybody else, and their total would mean
something different from everybody else's. It is the one thing a standings table
built on totals cannot survive.

**A stage cannot be drawn twice**, and the next one cannot be drawn while any
table in the current one is still playing. A board that reorders itself while
half the room is still playing is a board nobody in the room trusts.

### The console, and what it deliberately does not have

One button most of the time: draw the next stage. It is absent rather than
disabled when it cannot be pressed, and the card says what it is waiting for —
entrants, or tables still playing.

There is no seeding control, no way to move somebody between tables, and no way
to re-draw a stage that has been played. Every one of those would be a way to
decide who wins after seeing how they were doing.

### Sold with the licence, not beside it

A facilitator licence runs classes and tournaments both. Somebody who runs
classes and somebody who runs a competition are the same customer, a second
product is a second thing to explain, and — the practical half — it means this
ships with no new Stripe product, no new price variable, and a migration that is
one column and one table.

### What has not been measured

The jitter. Everything above hangs on how consistent a real player is between
games, and that number does not exist. It is measurable — the same person's
results across several ranked games, once enough people have played several —
and until it does exist, the honest form of this answer is the table and its
range, not a headline figure.

Harness: `npm run measure:tournament`, about two minutes.

## 44. The projection panel on a phone

A player reported that the panel showing expected profit and where the money goes
"goes off the page" — fine on a laptop, gone on a phone.

It was exactly that, and the CSS said so in one line:

```css
@media(max-width:900px){ .layout{grid-template-columns:1fr} .proj{position:static} }
```

Above 900px the projection is a sticky column beside the form and follows the
page down. Below it, the grid collapses to one column, the panel loses its
stickiness, and it lands underneath six order cards. So on a phone you scrolled
past every slider to reach the number — and once you were there, you could not
see the sliders.

That is not a cosmetic problem. The projection runs the real engine against the
orders being typed, and it is only worth anything *while* they are being typed. A
panel you can only see after you have finished deciding is a receipt, not a tool.

### What it does now

Under 900px the panel becomes a bar pinned to the bottom of the screen carrying
the one number, which opens into the whole breakdown. Above 900px nothing has
changed.

**One renderer, two hosts.** `renderProjection` builds the markup once and writes
it into both the sticky column and the bar's sheet; CSS decides which is on
screen. A second copy of that panel would drift, and drift in the panel that
claims to be running the real engine is worse than not having it.

**The warning count travels with the number.** "Nothing on advertising" is,
measured, the commonest way a good plan loses, and it should not be waiting
behind a tap. It shows as "2 to check" beside the profit, and it is empty rather
than reassuring when there is nothing — a badge reading "looks sound" next to a
$70,000 expected loss reads as the page contradicting itself.

**The bar is only there when there is something to project**, and the page only
reserves space at the bottom while it is. A phone should not carry 78px of dead
space on the home screen for a panel that is not being shown.

### Two things a screenshot caught that the CSS did not

The bar was **transparent** — `background: var(--bg)`, and there is no `--bg` in
this stylesheet. The numbers underneath read straight through it. It is
`--surface-1` now, the same colour every card uses.

And at 390px the label, the flag, the number and the chevron did not fit on one
line. The label now gives way first, because the number is the only one of the
four that must never be truncated.

Neither was visible from reading the stylesheet. Both were obvious in a
screenshot at 390 × 780, which is now `test/mobileui.mjs` — it checks the phone
layout and the laptop one in the same run, because the risk in a change like this
is fixing the phone and quietly breaking the laptop.

### The market table, and what was actually wrong

The same screenshot showed the market table clipped on the right: six columns of
numbers about your rivals, and the share column running off the edge.

Reflowing it was the obvious half. Each row is now a labelled block — the header
is hidden and every cell carries the heading it would have had — **paired into
two columns**, because one label per line is five rows a company and, at a full
table, twenty-five rows of scrolling before a player reaches their own orders.
Paired, it is three.

Scrolling it sideways instead would have been easier and wrong. This is the only
view a player has of what everybody else is doing, and a table you have to drag
is a table nobody reads.

**But the table was not what was widening the page.** With it fixed, the page
still scrolled sideways — 476px of content in a 390px screen. The culprit was the
orders column: a grid item will not shrink below its own content unless it is
told to, and that column holds a slider with a minimum width and a number box
beside it. One line — `.layout > * { min-width: 0 }` — plus a narrower number box
on small screens, and the page fits.

That is the more useful finding. The reported symptom was the table; the cause
was the form, and only measuring the whole page rather than the element that
looked wrong would have found it.

**One exception, deliberately.** The supply contract rate grid *does* scroll
sideways, inside its own box. It is genuinely two-dimensional — volume across,
term down — and reflowing it into a list would destroy the only thing it is for,
which is seeing both trade-offs at once. What it must not do is set the width of
the page, and the test checks that rather than checking it fits.
