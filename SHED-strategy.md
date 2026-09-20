# Emptying somebody else's shed

**The question:** what would be the strategy?

**The answer, measured:** there isn't one. Buying out of another captain's pile
is a loss every time, and the page I just shipped advertises the piles in blue
as if they were an opportunity.

## What a run is actually made of

200 seasons, the settings the game ships:

| | |
|---|---|
| a unit costs at the rock | **$85** |
| it fetches at the market | **$170** |
| the carrier's margin | **$86 a unit — 50% of the sale** |
| a 40% cut *of the sale* | **$68 a unit — 80% of the whole margin** |

The royalty is taken on the **gross sale**. A carrier's margin is half the
sale. So a 40% cut of the sale is four fifths of everything the run earns on
those units. Nothing the pile gives back can cover that.

## What the pile gives back

Stock at a rock damps the buying squeeze (`buyMultAt` subtracts the pile from
congestion before `buyMult`), so a carrier who turns up where goods are sitting
does buy cheaper. Measured, that discount is worth **$858 a run**.

The cut on the same run is **$4,077**.

## 400 seasons, every run that touched a pile

```
16,000 runs, 953 of them drew out of somebody's shed (6.0%)
  average units out of a pile : 59 of 107 bought
  the stock's buy discount    : $858 a run
  the keeper's cut            : $4,077 a run
  net to the carrier          : -$3,219 a run
  runs left WORSE off by it   : 953 of 953 (100%)
  median -$3,086   worst -$9,479   best -$44
```

**Not once in 953.** The best case in four hundred seasons was minus $44.

And the carrier never chose it. `drawFromPiles` takes from the piles first for
whatever was bought at that rock — so a pile is not an offer a captain can
decline. It is a hazard sitting on a loading spot, invisible except as the
blue stock number the page now prints next to it.

## Why no rate fixes it

400 seasons a cell. `margin` takes the cut on `got − paid` instead of the sale.

| rule | carrier who hits a pile | hurts | keeper earns | against rent |
|---|---|---|---|---|
| gross 40% (live) | **−$3,219** | 100% | $9,714 | $5,112 |
| gross 25% | −$1,653 | 100% | $5,832 | $4,919 |
| gross 15% | −$651 | 100% | $3,408 | $4,793 |
| gross 10% | −$158 | 80% | $2,242 | $4,731 |
| margin 60% | −$2,876 | 100% | $8,863 | $5,075 |
| margin 40% | −$1,606 | 99% | $5,711 | $4,917 |
| margin 25% | −$682 | 94% | $3,481 | $4,799 |

The rate that stops hurting the carrier (gross 10%, margin 25%) is exactly the
rate at which the keeper stops covering their own rent. **The mechanic is
zero-sum between the two seats, minus the rent, which is burnt.** It looked
balanced in the earlier pass because the keeper was measured against an
anticipator — and the money making the keeper whole was coming out of whichever
stranger happened to buy at that rock.

Discounting the shed goods does not rescue it either — the sale is twice the
buy, so a cut of the sale can never be paid for out of the purchase:

| | carrier | hurts |
|---|---|---|
| shed price 55% of posted, cut 40% | −$1,446 | 98% |
| shed price 60% of posted, cut 25% | −$110 | 54% |

Sixty per cent off and it is still a coin flip.

## The actual flaw

The goods get **paid for twice**. The keeper buys them and pays rent. Then a
carrier lifts them and pays the *market* full posted price for them — and on
top of that hands the keeper 40% of the sale. Two payments for one cargo, both
out of the carrier.

Any rule that has the carrier pay the market AND the keeper is going to be a
trap at some rate. The ones worth measuring next all have the carrier pay
**one** of them:

1. **The carrier pays the keeper, not the market.** Pile units cost the same as
   posted; the whole payment goes to the keeper instead of the void. Neutral
   for the carrier (a pile is never a trap again), and the keeper's profit
   becomes a real speculation — buy cheap, get lifted dear, minus rent. No
   royalty at all.
2. **Same, at a discount.** Pile units cost the carrier, say, 85% of posted and
   the keeper gets that. Now the carrier has a reason to seek piles out and the
   keeper has a reason to want traffic — a two-sided deal, which is what the
   mechanic was for.
3. **Leave the rules, fix the page.** Print the stock as a hazard, not in blue.
   Honest, and one line of CSS — but the keeper stays a parasite and the "first
   thread of cooperation" is gone.

None of these is shipped. Each changes the keeper's balance against an
anticipator and would need the eight-round five-captain measurement rerun.

---

# Option 2, measured — and what measuring it found

**The rule tried:** pile units cost the carrier a fraction of posted, the whole
payment goes to the keeper, no royalty on the sale. 400 seasons a rate, the
real engine, the shipped five-captain eight-round table.

## The carrier half is fixed

| shed price | carrier who hits a pile | hurts | worst case |
|---|---|---|---|
| live: 40% of the sale | **−$3,219** | 100% | −$9,479 |
| 100% of posted | +$860 | **0%** | +$8 |
| 90% of posted | +$1,245 | **0%** | +$18 |
| 85% of posted | +$1,433 | **0%** | +$22 |
| 80% of posted | +$1,625 | **0%** | +$27 |
| 70% of posted | +$1,998 | **0%** | +$34 |

Not one run in 400 seasons left worse off at any rate. The trap is gone.

## The keeper half is not, and never was

The same runs, keeper against an anticipator — the comparison that matters:

| | keeper | anticipator | difference |
|---|---|---|---|
| no warehouses at all | $52,360 | $62,975 | −$10,615 *(that seat's shade, not the shed)* |
| live: 40% of the sale | $37,445 | $60,681 | **−$23,237** |
| shed at 85% of posted | $36,147 | $64,188 | **−$28,041** |

So keeping a shed costs **$12,622** under today's rules and **$17,426** under
the fix. The fix is worse for the keeper because it hands the carrier a
discount on top.

The earlier "$592 behind, which is nothing" came from the sixteen-round
harness, not from this engine. It never travelled, and nobody checked.

## Where the money goes

A keeper's season, 400 of them:

```
  bought and left behind : 342 units for $27,796
  rent paid on them      : $5,112
  taken when lifted      : $9,714
  never lifted at all    : 31% of the units — $8,645 of goods burnt
  net on the shed        : -$23,194
```

The cut is not the problem. The keeper spends $27,796 and gets $9,714 back.

## Why no rule can fix it

```
across 15,891 runs: $137,191,369 of goods bought, $35,839,320 of profit
  a dollar spent on cargo comes back with 26 cents, in ONE round
  a dollar left in a shed for 1 round gives up 26 cents of trade
  a dollar left in a shed for 2 rounds gives up 59 cents of trade
  a dollar left in a shed for 3 rounds gives up 101 cents of trade
```

Lifted stock waits **2.0 rounds** on average (53% one round, 31% never lifted).

Now put the two sides next to each other, per unit:

- **the carrier** will only take shed goods if they are **cheaper than $85** —
  the rock has an unlimited supply at a posted price, always
- **the keeper** needs **$85 + $10 rent + $50 of forgone trade = $145** to
  break even on a two-round wait

There is no price between $145 and $85. It is not a balance problem and no
rate sits in that gap, because the gap is negative. A commodity in unlimited
supply at a posted price cannot be worth storing.

Prices would have to do the work instead, and they do not: a spot's buy price
moves **16.6%** from round to round (34% in the top tenth), and a keeper needs
a **71%** rise to break even over two rounds.

## What that leaves

1. **Turn warehouses off on the ranked table.** One flag. It also stops a fifth
   of every table — the keeper bot plays them all — from running a style that
   loses $23,000 a season.
2. **Ship the carrier fix anyway**, so a private table with warehouses on is
   never a trap even though nobody should keep a shed.
3. **Give a pile something the rock cannot give.** The only lever measured to
   be large enough: a loading spot that can only supply so much a round. Then
   stock genuinely beats the posted price and both sides have a deal. That is a
   change to the economy, not to the shed, and it wants its own prototype
   before anything live is touched.

---

# What shipped

**The rule:** what a carrier buys out of a shed is paid to the captain who put
it there instead of to the market. Same bill, a different till. No cut of
anybody's sale, anywhere.

Two corrections came with it, and both are the same idea — **stock is stock,
not a bonfire**:

- **rent $5 → $2**
- **the sheds are cleared at the end of the season** at the rock's posted price,
  rather than whatever is left being burnt

And the keeper bot was storing a third of its spare purse on a 2% signal, which
under the old rules made a fifth of every ranked table a punching bag. It now
stores 15% on a 10% signal.

## Measured on the shipped engine, 600 seasons a row

| | keeper | anticipator | difference | leader holds | comeback |
|---|---|---|---|---|---|
| no warehouses at all | $52,713 | $62,803 | −$10,090 | 57.0% | 3.5% |
| **as shipped** | $52,473 | $63,167 | **−$10,695** | 58.5% | 3.0% |

**Keeping a shed costs $616** — against $12,622 before. Nothing is ever
stranded. 175 units a season go into sheds, 65 of them are lifted by a rival,
the rest are sold back.

And a pile cannot cost a carrier anything, which is now asserted rather than
measured: `paid` uses `buyMultAt`, which subtracts stock from congestion, so it
can only go **down**; and nothing is deducted afterwards, because the money for
those units was already in the purchase.

## The honest limit, said on the page

No rule makes a shed pay, and storing more is monotonically worse at every
level measured:

| the bot stores | keeper vs anticipator |
|---|---|
| nothing | −$10,090 |
| 8% of spare | −$10,282 |
| 15% of spare *(shipped)* | −$10,695 |
| 25% of spare | −$11,524 |
| 35% of spare | −$12,321 |
| 60% of spare | −$13,595 |

So the shed card says it: *"It is a bet on the price and a way to sit out of
the crowd; it is not a way to get rich."* A mechanic that costs a little and
says so is honest. One that costs a little and implies otherwise is the thing
this whole document started as.

## A leak, found by walking the loop

Printing the sentences a captain would actually read turned up something no
test had asked about: the carrier's own history row carried `takings`, the list
of **which seat** was paid for the goods they had just loaded — and `stored`
named who had left what, where. Nothing on screen showed either. Both were one
API response away, and between them they gave away the only thing the mechanic
keeps secret.

`viewFor` now sends a captain only their own entries in both. Four assertions
cover it, including a flat `!/"owner"/` over the carrier's whole round.

It was in the first version too. The test suite checked the stock, the board
and the manifests for owner names, and never thought to check the receipt.
