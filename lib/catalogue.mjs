/* What the company actually makes.

   The engine has always had four kinds with genuinely different economics and
   no story attached to any of them. A player was told "Hardware" and left to
   care about it. This is the story: sixty products, fifteen a kind, one drawn
   at the start of a game and given to everybody at the table.

   ── the scale everything here has to fit ─────────────────────────────────────

   C.VALUE_REF is 100 for every kind, so a product of ordinary quality is worth
   about $100 to a buyer whatever it is. Only what it costs to build changes:

       hardware   $45.00 to build, sells near $100    55% margin
       software    $4.05 to build, sells near $100    96% margin
       commodity  $27.90 to build, sells near $100    72% margin
       deep tech  $51.75 to build, sells near $100    48% margin

   That is the rule every name here obeys, and it is a tighter rule than it
   looks. Aircraft engines and chewing gum both break it, in opposite
   directions, and a student who knows the industry spots it immediately. A
   concrete product that contradicts the numbers costs more credibility than an
   abstract one ever did.

   ── what the four kinds actually mean ────────────────────────────────────────

   Worth saying plainly, because two of the labels mislead:

   COMMODITY does not mean cheap. It sells for the same $100 as everything
   else. It means *hard to tell apart* — research leverage is 0.45, so quality
   barely moves however much you spend. Cheap to start ($70,200) and cheap to
   run ($26,000 a round), and you will never differentiate your way out of a
   price fight. Several of these are sold by the case, which is how an
   undifferentiated thing reaches a hundred dollars a unit.

   SOFTWARE does not mean free. Four dollars a copy, but $70,000 a round in
   people — the highest fixed cost of any kind — and it goes stale at 1.6× the
   normal rate. No stock is ever held, so overbuilding costs nothing and
   underbuilding costs everything.

   DEEP TECH is components and modules sold in volume, not finished systems. A
   lidar unit at fifty dollars to build is real; a lidar-guided vehicle is not.
   Dear to launch ($207,000), thin margin, and research compounds at 1.70 but
   lands a round late.

   ── variants, and why a new line is not a different product ─────────────────

   Every line at a table competes in one shared demand pool — a company running
   two lines competes with itself as well as with everyone else. So a second
   line cannot be a different product without the fiction contradicting the
   model: a player told they make grinders and offered helmets will expect a
   second market and get a second helping of the same one.

   Hence `variants`. Your second line is another version of what you already
   make, which is exactly what the engine simulates: same buyers, split between
   your own products, each with its own plant to pay for. Cannibalisation stops
   being a nasty surprise and becomes the thing the round teaches.

   Launching into a different kind stays possible and stays priced — engine
   newLine() carries over 60% of accumulated know-how instead of 100%. That is
   related versus unrelated diversification with a number on it, and it is
   worth showing rather than hiding behind a filtered list. */

export const CATALOGUE = {
  hardware: [
    { name: 'Espresso grinders',      variants: ['a commercial grinder', 'a compact grinder', 'a hand grinder'] },
    { name: 'Bike helmets',           variants: ['a road helmet', 'a commuter helmet', "a child's helmet"] },
    { name: 'Desk lamps',             variants: ['an architect lamp', 'a clip-on lamp', 'a floor lamp'] },
    { name: 'Electric kettles',       variants: ['a travel kettle', 'a glass kettle', 'a gooseneck kettle'] },
    { name: 'Bluetooth headphones',   variants: ['an over-ear pair', 'a sports pair', 'a budget pair'] },
    { name: 'Cast-iron pans',         variants: ['a griddle pan', 'a casserole pot', 'a crêpe pan'] },
    { name: 'Cordless drills',        variants: ['a compact drill', 'a hammer drill', 'an impact driver'] },
    { name: 'Cabin suitcases',        variants: ['a weekend duffel', 'a garment carrier', 'a hard-shell case'] },
    { name: 'Baby monitors',          variants: ['an audio-only monitor', 'a camera monitor', 'a wearable monitor'] },
    { name: 'Electric toothbrushes',  variants: ["a children's brush", 'a travel brush', 'a whitening brush'] },
    { name: 'Air purifiers',          variants: ['a desk purifier', 'a bedroom purifier', 'a car purifier'] },
    { name: 'Mechanical keyboards',   variants: ['a compact board', 'an ergonomic board', 'a wireless board'] },
    { name: 'Camping stoves',         variants: ['a backpacking stove', 'a two-burner stove', 'a wood-burning stove'] },
    { name: 'Record players',         variants: ['a belt-drive deck', 'a portable deck', 'a DJ deck'] },
    { name: 'Sewing machines',        variants: ["a beginner's machine", 'a heavy-duty machine', 'an overlocker'] },
  ],

  commodity: [
    { name: 'Task chairs',            variants: ['a drafting stool', 'a mesh-back chair', 'a footrest'] },
    { name: 'Steel shelving',         variants: ['a corner unit', 'wall-mounted rails', 'a garage rack'] },
    { name: 'Power strips, by the case', variants: ['surge-protected strips', 'outdoor strips', 'USB strips'] },
    { name: 'Work gloves, by the case',  variants: ['cut-resistant gloves', 'insulated gloves', 'disposable gloves'] },
    { name: 'Trade paint, five-litre tins', variants: ['primer', 'exterior paint', 'floor paint'] },
    { name: 'Hose and reel sets',     variants: ['soaker hose', 'a sprinkler set', 'a nozzle kit'] },
    { name: 'Storage crates, tens',   variants: ['lidded crates', 'document boxes', 'under-bed boxes'] },
    { name: 'Copier paper, ten reams', variants: ['coloured stock', 'card stock', 'recycled paper'] },
    { name: 'Mop and bucket sets',    variants: ['a floor scrubber', 'a dustpan set', 'a window kit'] },
    { name: 'Folding tables',         variants: ['folding chairs', 'a trestle pair', 'a picnic set'] },
    { name: 'Towel sets',             variants: ['hand towels', 'beach towels', 'bath mats'] },
    { name: 'Padlocks, by the dozen', variants: ['combination locks', 'bike locks', 'hasp sets'] },
    { name: 'LED tubes, by the case', variants: ['LED panels', 'bulkhead lights', 'floodlights'] },
    { name: 'Plastic pipe, bundled',  variants: ['fittings kits', 'guttering', 'drainage pipe'] },
    { name: 'Duct tape, by the case', variants: ['masking tape', 'packing tape', 'electrical tape'] },
  ],

  software: [
    { name: 'A photo editor',         variants: ['a mobile version', 'a professional tier', 'a plugin pack'] },
    { name: 'A password manager',     variants: ['a family plan', 'a business tier', 'a browser add-on'] },
    { name: 'An accounting package',  variants: ['an invoicing-only edition', 'a payroll module', 'a mobile app'] },
    { name: 'A music production suite', variants: ["a beginner's edition", 'a sample pack', 'a plugin bundle'] },
    { name: 'Tax filing software',    variants: ['a self-employed edition', 'a business edition', 'a prior-year edition'] },
    { name: 'A project scheduler',    variants: ['a team edition', 'a mobile app', 'a reporting module'] },
    { name: 'A VPN subscription',     variants: ['a family plan', 'a router edition', 'a business plan'] },
    { name: 'A video editor',         variants: ['a mobile version', 'a colour-grading module', 'a template pack'] },
    { name: 'A CAD package',          variants: ['a hobbyist edition', 'a rendering add-on', 'a mobile viewer'] },
    { name: 'A language course',      variants: ['an advanced course', 'a business course', "a children's course"] },
    { name: 'A note-taking app',      variants: ['a team edition', 'a handwriting module', 'a web clipper'] },
    { name: 'Backup software',        variants: ['a cloud tier', 'a server edition', 'a mobile app'] },
    { name: 'A statistics package',   variants: ['a student edition', 'a plotting module', 'a teaching licence'] },
    { name: 'A screen-recording tool', variants: ['a streaming edition', 'an editing add-on', 'a mobile app'] },
    { name: 'A font library',         variants: ['a display pack', 'an icon set', 'a licence extension'] },
  ],

  deeptech: [
    { name: 'Lidar modules',          variants: ['a short-range module', 'an automotive-grade module', 'a developer kit'] },
    { name: 'Glucose sensors',        variants: ['a continuous monitor', 'a patch sensor', 'a reader unit'] },
    { name: 'Solid-state battery cells', variants: ['a high-capacity cell', 'a fast-charge cell', 'a cold-weather cell'] },
    { name: 'Fibre-optic transceivers', variants: ['a long-haul unit', 'a short-reach unit', 'a bidirectional unit'] },
    { name: 'MEMS pressure sensors',  variants: ['an industrial sensor', 'a medical-grade sensor', 'a high-temperature sensor'] },
    { name: 'Water-testing cartridges', variants: ['a heavy-metals panel', 'a bacterial panel', 'a field kit'] },
    { name: 'Thermal imaging cores',  variants: ['a handheld core', 'a drone-mounted core', 'a fixed core'] },
    { name: 'RFID reader modules',    variants: ['a long-range reader', 'a handheld reader', 'an embedded reader'] },
    { name: 'Ultrasonic flow meters', variants: ['a clamp-on meter', 'an inline meter', 'a portable meter'] },
    { name: 'Air-quality sensors',    variants: ['a particulate sensor', 'a VOC sensor', 'an outdoor-rated sensor'] },
    { name: 'Diagnostic cartridges',  variants: ['a rapid panel', 'a clinical panel', 'a home kit'] },
    { name: 'Piezoelectric actuators', variants: ['a precision actuator', 'a high-force actuator', 'a miniature actuator'] },
    { name: 'Fuel-cell stacks',       variants: ['a portable stack', 'a backup stack', 'a marine stack'] },
    { name: 'Radiation dosimeters',   variants: ['a personal badge', 'an electronic dosimeter', 'an area monitor'] },
    { name: 'GNSS positioning modules', variants: ['a high-precision module', 'a low-power module', 'a dual-band module'] },
  ],
};

export const KIND_ORDER = ['hardware', 'commodity', 'software', 'deeptech'];

/* One product for the whole table, drawn from the game's own seed so every
   group in a cohort faces the same market — which is the property an
   instructor is actually buying. Never per player: four companies selling
   four different things would be competing over one pool of buyers, which is
   not a thing that makes sense. */
export function drawProduct(rnd, kind) {
  const k = kind || KIND_ORDER[Math.floor(rnd() * KIND_ORDER.length)];
  const list = CATALOGUE[k];
  const pick = list[Math.floor(rnd() * list.length)];
  return { kind: k, name: pick.name, variants: pick.variants.slice() };
}

/* What to offer when somebody launches a second line. Same kind first, because
   that is both the cheaper move and the one the fiction supports; other kinds
   after, with the know-how they would forfeit stated rather than discovered. */
export function launchOptions(current) {
  const same = (CATALOGUE[current.kind].find((p) => p.name === current.name) || {}).variants || [];
  return {
    sameKind: {
      kind: current.kind,
      carry: 1,
      label: 'Another version of what you make',
      options: same.slice(),
    },
    otherKinds: KIND_ORDER.filter((k) => k !== current.kind).map((k) => ({
      kind: k,
      carry: 0.6,
      label: 'A different business',
      note: 'You would keep 60% of what this company has learned.',
      options: CATALOGUE[k].map((p) => p.name),
    })),
  };
}

export const COUNTS = KIND_ORDER.reduce((acc, k) => {
  acc[k] = CATALOGUE[k].length; return acc;
}, {});
