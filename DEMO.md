# Friday walkthrough — runbook

Twenty-five minutes, five acts, in this order. The order matters: it opens with
the thing that always looks alive and closes with the numbers, so nobody is
staring at an empty leaderboard while you explain what the product will be.

Read the pre-flight list an hour before. Everything on it is something that
looks broken if you skip it.

---

## Pre-flight — Friday morning

Do these in order. The last one is time-sensitive.

- [ ] **`/g/` footer** reads the current build on **both** halves — page and
      server. If only one has updated, half the site is old.
- [ ] **`/api/pulse`** returns a sentence. This is act five; check it works.
- [ ] **`/api/bot/board`** has at least one entry. If it is empty, run
      `node bots/reference-bot.mjs --games 6` and wait five minutes.
- [ ] **Your record** (`/g/` → Your record) shows a profile rather than "a
      profile appears after 5 ranked games".
- [ ] **One invitation** sits in your player inbox, so that screen is not empty.
- [ ] **Sign out and back in** on the machine you will demo from. Do not
      discover a stale session in front of them.
- [ ] **Two or three ranked games, two hours before.** The leaderboard decays
      10% an hour — half-life 6.6 hours — so games played yesterday are gone.
      This is the only item that must happen on the day.

Open in tabs, in this order, before they arrive:
`/` · `/g/` · `/api/pulse?hours=168`

---

## Act 1 — The game itself (4 minutes)

**Start at `/`.** The single-player game, no account, nothing to sign up for.

Play one round live. Set a price, set production, press **Run round**.

What to point at:

- The **projection panel** on the right. It runs the real engine against the
  orders being typed — not a reimplementation that can drift out of step with
  the server.
- **Everyone commits blind.** You set your price without seeing anyone else's.
  That is the whole game.

The line worth saying once: *the same economy file runs the solo game, the
multiplayer page and the server, inlined into all three, byte-identical.* One
engine, three places, no possibility of them disagreeing.

Then click **Play people →** in the header, which lands you on `/g/`.

---

## Act 2 — The classroom (7 minutes)

**This is the product with a buyer. Give it the most time.**

`/g/` → **Teaching with this?** → **Open the facilitator demo**.

Say plainly: *no login, no signup, no sales call — an instructor evaluating this
at eleven at night can see the whole thing in ten minutes.* That is deliberate,
and it is unusual in education software.

The demo is a real class already running: **six groups, thirty students, five
rounds played, including one student who has never filed once.**

1. **Push it forward** two or three rounds. Watch the group board move.
2. **Say the thing that sells it**: every group faces an *identical* market —
   same customers, same costs, same shocks in the same rounds. So a difference
   between groups is a difference in what people decided, not who drew the
   easier economy. No instructor can be argued with on that, and it is the
   first thing they ask.
3. **Open the analysis.** Show the findings — a price war, a company nobody had
   heard of, customers turned away. **Every finding carries a question to ask
   the room.** Not generated prose: shapes somebody looked for, with the numbers
   attached.
4. **Download the debrief.** Self-contained HTML, no scripts, prints, survives
   being emailed to thirty students.
5. **Sit in a student's chair** — the button is right there — so they see what a
   student sees.

Price: **$149 per instructor**, students join free with no account. The
comparison is a commercial simulation charging per student.

---

## Act 3 — What makes this different (6 minutes)

**This is the act that separates you from everyone else pitching a business
game. Do not rush it.**

The claim: *this thing keeps telling you what it does not know.*

Three examples, in ascending order of strength.

**One — the leaderboard does not measure skill.** We measured whether it
predicts how good a player is. Among strong players it gets **worse** the more
they play: correlation 0.45 at ten games, 0.21 at forty, 0.14 at eighty. With
enough attempts everyone's best game is their luckiest one. It is a fine game
mechanic and a terrible measure of a person, so the profile is built from the
average instead.

**Two — most of what we can measure is not solid enough to publish.**
Advertising, borrowing and margin are still wrong more often than not after
twenty games. They are stored and never shown.

**Three — and this is the one to land.** The strongest signal on the site is
what somebody does after a bad round. Three games separates a persister from
someone who walks away a quarter of the time, at **97% reliability**, almost
untouched by ability. It is the best statistic here and **we refuse to publish
it** — because in a fifty-minute game a missed deadline means a meeting started
or a child woke up, and a measure like that ranks people by how much
uninterrupted time they have.

Then show it. **`/g/` → Your record → "What is deliberately not shown".** Four
rows, each with its reason, on the page where the person it describes can read
it.

If one screen carries the pitch, it is that one.

---

## Act 4 — The other three revenue lines (5 minutes)

Quick. One minute each, no deep dives.

**Ranked play** — free, no account. The funnel. Empty seats fill with AI
companies and nobody learns who was who until the last round is scored.

**The bot league** — `Write a bot` → `The bot league`. A documented API, a
runnable reference bot in 150 lines, its own board ranked by average money made
rather than by total. Say why: *somebody was always going to automate this, so
rather than policing it we gave it somewhere better to go.* Universities
teaching analytics have a term's project sitting in `BOTS.md`.

**Hiring** — the player's record, the opt-in, and one invitation in the inbox.
The rules are the pitch: one approach per player *for ever*, twenty a day, no
free text to a person, nothing ranks the pool. An invitation to apply is
sourcing; a ranked shortlist handed to an employer is a selection procedure
under a different body of law. That distinction is why this is buildable at all.

---

## Act 5 — The numbers, honestly (3 minutes)

**Open `/api/pulse?hours=168` in front of them.** Live, not a slide.

Then say: *I built this endpoint because somebody asked me whether anyone had
played and I could not answer. That is the same instinct as everything in act
three.*

Turning weak traction into evidence of rigour is the move here, and it only
works because it is true.

### What to quote

| | |
|---|---|
| Live since | this week |
| Unique visitors, 7 days | 64 |
| People who played | 17 |
| Games played | 14 |
| Rounds played | 99 |
| **Games abandoned in the lobby** | **0** |
| Revenue | none — payments are in test mode |
| Players opted into hiring | seed this before Friday |
| Hosting cost | $9/month, of which 98% is deploys |

**The number to lead with is the zero.** Every game that opened was played to
the end. For a product nobody had seen before, that completion rate is the best
figure on the page — better than the visitor count, and it is the one that
suggests the thing actually works when someone tries it.

### Unit economics — from §29 of the design doc

| | |
|---|---|
| Cost of one game, adaptive polling | **$0.0039** |
| A million games a month | ~$3,900 |
| A player who never pays anything | 78 cents |
| A $19.99 name | covers ~4,900 games of that player's play |

Measured, not estimated — the polling work took the cost of a million games from
$22,000 a month to $3,900, and §29 shows the arithmetic.

---

## Questions they will ask

**"How many paying customers?"**
None. Payments are in test mode; the live account is being activated. One person
has been given access by hand. Say it flatly and move on — the moment you soften
this is the moment they start checking everything else.

**"Who else does this?"**
Capsim and Cesim in classrooms, and Capsim already sells assessments to
employers. Pymetrics did gamified hiring assessment and was absorbed by Harver.
Two Sigma ran Halite as a recruiting funnel. **None of the four ideas is new on
its own; the assembly might be, and the measurement discipline is.** Knowing
your own prior art cold is worth more than pretending there isn't any.

**"What stops a big incumbent building this?"**
Nothing stops them building the features. What they cannot copy quickly is five
hundred simulated seasons of a calibrated economy, and a record of what was
measured and then refused. Also worth saying: the incumbents' problem is that
their assessment products have been through disparate-impact scrutiny, and the
refusals here are what that scrutiny asks for.

**"What's the biggest risk?"**
Distribution. Say it before they do. Four products, seventeen users, and the
scarce thing is not novelty, it is the first hundred players. The plan is
instructors — it is August, they are picking materials for the autumn term this
week, and one instructor with a section of forty is more players than the site
has had in total.

**"Can a player negotiate with anyone — suppliers, landlords, staff?"**
Now yes, for materials. Leasing space and paying for performance were already in
the game under other names (`targetCapacity` and process R&D), and duplicating
them would have made the screen longer without making the decision harder. Input
costs were the real gap, so there is now a supply contract: commit to a volume
for a run of rounds and the supplier fixes your rate against the market.

The answer worth giving is the second half. **It was built three times.** The
first version was too generous — it beat never signing by $23,549 a season and
went bankrupt less often, which sounds like success and is actually a free lever
everybody should pull. The second was priced fairly and turned out to be a trap:
take-or-pay at full price made the worst seasons worse, not better. The third
works: a contract sized to your own production costs a few thousand on the median
and takes $11,000 off the worst tenth of seasons, and signing one while a cost
shock is running is worth $12,929 against -$2,411 for signing blind — so reading
the headlines finally has a price on it.

**Say the state of it plainly**: the server side is finished and tested; the
screen for it is not built yet, so do not go looking for it in the interface.
§38 of the design doc has all three calibrations, including the two that were
wrong. That is the answer, not the feature.

**"Can they choose how to change the size of the factory — buy or lease?"**
Yes, both directions, and the interesting number is the boundary. Renting plant
in is available the round you ask for it; buying takes a round to arrive. So
renting wins a short squeeze ($311,413 against $298,425) and buying wins a
permanent need by $43,000. If renting had won both, capital expenditure would
have been dead and the feature should not have shipped — that was the test it
had to pass.

Renting in keyed to an announced supply crunch is worth $37,722 a season with a
*better* worst case than not renting at all. Doing it blindly costs $63,505 and
bankrupts one company in six.

**Renting plant out is the weak half and the honest thing is to say so.** The
best rule anybody could find is worth $5,484, and renting the factory out
blindly collapses sales 29% and kills more than half the companies that try it.
It stays in because it is far better than the alternative the game already
offered — selling into a 60% resale haircut — and because the trap teaches
something real. §39 has all of it, including a money pump found and closed
during calibration.

Same state as the supply contract: server side finished and tested, screen not
built.

**"Could an instructor run it twice in a semester — a basic level and an
advanced one?"**
Yes, and the measured answer is more interesting than a yes. Eight distinct ways
of playing, 300 seeded seasons each. Handling the new negotiation levers well
rather than badly is worth **$97,755** — 45% of what all the base decisions are
worth among players who actually survive. And it changes who wins: in **32% of
pairs**, a weaker player who reads the headlines overtakes a stronger one who
pulls the new levers blind. It is a genuinely separate skill, not a multiplier.

**But the bigger finding is the other direction.** Hiding two levers the game
*already has* — process research and launching — from a first sitting is worth
**$290,735** of separation, three times what contracts and leases add together.
The most self-destructive thing a beginner can do in this game is over-invest in
process research; that style goes bankrupt in 91% of seasons. A first game where
a student can destroy their company nine times in ten with a lever nobody has
taught them yet is a bad first game.

So the two levels should be: **first sitting, five decisions a line** — price,
build, advertising, quality research, plant size, one product. **Second sitting,
everything** — plus process research, launching, contracts and leases. Roughly
three parts existing complexity revealed to one part new mechanics.

That gating is now built — the host picks the level when starting a game, and
the class form defaults to a first game. Level 1 shows five controls a line
instead of six and drops three cards from the orders screen. Ranked play and the
bot league are pinned to the full game, because one leaderboard needs one rule
set. §40 has the numbers, including a first version of the test that gave a
confidently wrong answer; §41 has how it was built, including the archetypes
being made to play by the same rules — a bot quietly using a lever the students
cannot see would have been invisible and unexplainable.

Both mechanics now have an interface. The supply contract shows the whole rate
curve as a grid you click a cell of — volume improves the rate rightwards, term
worsens it downwards, so the trade-off is the layout. Leasing sits inside each
product line, next to the control for building or selling plant, because that is
the decision it competes with.

**Worth demonstrating:** the projection panel accounts for both, and there is a
browser test that signs a contract, lets the round resolve, and checks the
predicted settlement against the charged one. Drift is $0 on both the ordinary
branch and the shortfall. §42 explains why that test exists — the page has to
hold a second copy of the settlement arithmetic, and this is what stops it
drifting.

**"Could someone buy a licence to run a tournament?"**
Yes, and the measurement changed the shape of it. A knockout bracket — groups of
six, winners advance — crowns the strongest entrant about **one time in four**,
and running more games inside a knockout does not help: 22% at seven tables, 20%
at twenty-one, because elimination throws the information away.

Ranking on aggregate over the same eighteen tables gets it right 28% of the time
and puts the best entrant in the final three **73%** of the time against a
knockout's 56%. So the format is a **league with a final**: everyone plays three
tables in re-drawn groups of six on identical seeded markets, ranked on money
made, top six play a final.

Two things worth saying out loud. The commercial argument agrees with the
measurement — a knockout sends thirty of your thirty-six paying attendees home
after the first hour. And **Swiss pairing makes it worse**, which surprised me:
in chess a win is a win, but here the score is money made and money made depends
who you are seated with, so concentrating the strong players suppresses their
own numbers. 77% against 88%.

It folds into the existing $149 facilitator licence, so there is no new product
to sell — and it is built: create an event, send a link, people enter with a name
and no account, press one button a stage. §43 has all of it, including two
versions of the measurement that flattered the product before I caught them.

**Worth showing if there is time.** Create one on the spot, enter from your
phone, draw a stage. The entrant screen is the thing to point at: they hold one
link all afternoon and get re-seated at a new table every stage without ever
seeing a game code.

**"Why should we believe the measurements?"**
Every one is in `CEO-economy-design.md`, 44 sections, with the numbers and the
wrong turns left in. Offer to send it. It is the strongest document you have.

---

## Do not click

- **The leaderboard**, unless you played games that morning. It decays.
- **The recruiter pool**, unless you seeded opt-ins. An empty pool with the
  word "hiring" over it is worse than not mentioning it.
- **A level-1 game**, if you want to show contracts or leases — they are not
  there, deliberately. Create the game at **The full game** before demoing them.
- **Any class you started earlier in the week** — demo classes expire after four
  hours and are deleted with their games. Use the seeded demo, which is
  regenerated on demand and always looks the same.
- **Checkout**, unless you are ready to say "this is test mode" in the same
  breath. Better: mention payments, don't demonstrate them.

## If something breaks

- **A screen looks stale** → footer at the bottom of `/g/` tells you whether
  page and server agree. Say "that's the build stamp — it's how I know which
  version is live", and you have turned it into a point about rigour.
- **A game says it no longer exists** → that is the fix from Wednesday working.
  Reload; it will not loop.
- **Anything 503s about the database** → the schema did not run. Nothing to be
  done live; skip that act and carry on.
- **Everything is slow on first click** → cold start on the functions, about two
  seconds, once. Click one API endpoint before they arrive to warm it.

---

*Rehearse acts two and three out loud once. They are the two that carry the
pitch, and they are the two where it is tempting to improvise.*
