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

/* ── what research actually put IN the thing ─────────────────────────────────

   The engine has no features. R&D moves one number, quality, and that number
   is real: across a ten-round season it separates $0 of research (81 → 56, and
   bankrupt by round eight) from $80,000 a round (81 → 133). What the engine
   also has, and has always thrown away, is the DATE: a project funded in round
   three lands in round five, and upkeep() knows exactly when.

   So the product screen names the nth landing with the nth entry from this
   list. The landing is the engine's, the quality gain is the engine's, the
   round it was funded is the engine's — the NAME is written here. That is
   flavour attached to a real event, not a number invented to look like one,
   which is why the screen prints the true figures beside whatever it says was
   added. A player who ignores the words still sees the arithmetic.

   Order matters: cheap fixes first, then the engineering somebody had to save
   up for. Five is enough — a line that lands more than five research projects
   in a ten-round season has been doing very little else. */
export const IMPROVEMENTS = {
  /* hardware */
  'Espresso grinders': ['stepped burr adjustment', 'a quieter motor mount', 'timed dosing',
    'an anti-static chute', 'a direct-drive gearbox'],
  'Bike helmets': ['deeper vent channels', 'a magnetic buckle', 'a fit dial at the nape',
    'a rotation-slip liner', 'an in-mould shell'],
  'Desk lamps': ['a dimmer wheel', 'a warmer colour setting', 'a weighted base',
    'friction-free arm joints', 'a flicker-free driver'],
  'Electric kettles': ['a faster element', 'a cool-touch handle', 'a limescale filter',
    'a hold-temperature setting', 'a quieter boil plate'],
  'Bluetooth headphones': ['a longer battery', 'a better ear seal', 'multipoint pairing',
    'active noise cancelling', 'custom drivers'],
  'Cast-iron pans': ['a machined cooking face', 'a pre-seasoned finish', 'a balanced handle',
    'a helper handle', 'a thinner, more even base'],
  'Cordless drills': ['a brushless motor', 'an LED work light', 'finer clutch steps',
    'a battery fuel gauge', 'an all-metal chuck'],
  'Cabin suitcases': ['quieter wheels', 'reinforced corners', 'an expander zip',
    'a lighter frame', 'a built-in scale'],
  'Baby monitors': ['longer range', 'night vision', 'an encrypted link',
    'a room-temperature sensor', 'cry detection'],
  'Electric toothbrushes': ['a pressure sensor', 'a two-minute timer', 'a longer charge',
    'a quieter drive', 'a range of replaceable heads'],
  'Air purifiers': ['a quieter fan', 'a true HEPA stage', 'a filter-life indicator',
    'a carbon layer', 'an auto mode with a sensor'],
  'Mechanical keyboards': ['better stabilisers', 'sound-damping foam', 'hot-swap sockets',
    'per-key lighting', 'a wireless receiver'],
  'Camping stoves': ['a wind shield', 'piezo ignition', 'a proper simmer control',
    'folding legs', 'a lighter alloy burner'],
  'Record players': ['a better tonearm bearing', 'an adjustable counterweight', 'isolated feet',
    'an upgraded cartridge', 'a speed-stable motor'],
  'Sewing machines': ['a quieter drive', 'a one-step buttonhole', 'better feed dogs',
    'a needle threader', 'an adjustable presser foot'],
  /* commodity */
  'Task chairs': ['firmer foam', 'adjustable arms', 'a better gas lift',
    'a breathable mesh back', 'lumbar adjustment'],
  'Steel shelving': ['thicker uprights', 'boltless clips', 'a powder-coat finish',
    'a higher load rating', 'levelling feet'],
  'Power strips, by the case': ['a better surge clamp', 'spaced sockets', 'a tougher cable',
    'individual switches', 'a flame-retardant housing'],
  'Work gloves, by the case': ['a better grip coating', 'a reinforced thumb', 'a breathable back',
    'a longer cuff', 'cut-resistant yarn'],
  'Trade paint, five-litre tins': ['better coverage', 'quicker drying', 'less spatter',
    'tougher scrub resistance', 'low odour'],
  'Hose and reel sets': ['a kink-resistant hose', 'brass fittings', 'a smoother reel',
    'a longer length', 'a leak-free coupling'],
  'Storage crates, tens': ['stronger corners', 'secure lid clips', 'stacking ribs',
    'clearer walls', 'recycled resin'],
  'Copier paper, ten reams': ['less jamming', 'a brighter white', 'a smoother finish',
    'a tighter cut', 'certified pulp'],
  'Mop and bucket sets': ['a better wringer', 'a replaceable head', 'a sturdier handle',
    'a spill-proof lid', 'a microfibre head'],
  'Folding tables': ['stronger hinges', 'non-slip feet', 'a lighter top',
    'locking legs', 'a scratch-resistant surface'],
  'Towel sets': ['a softer weave', 'better absorbency', 'colour-fast dye',
    'reinforced hems', 'faster drying'],
  'Padlocks, by the dozen': ['a hardened shackle', 'a keyed-alike option', 'a weather seal',
    'anti-pick pins', 'a boron shackle'],
  'LED tubes, by the case': ['higher efficacy', 'a flicker-free driver', 'a wider beam',
    'a longer rated life', 'better colour rendering'],
  'Plastic pipe, bundled': ['tighter tolerance', 'easier joints', 'a UV-stable compound',
    'a pressure-rated wall', 'clearer markings'],
  'Duct tape, by the case': ['a stronger backing', 'a better adhesive', 'cleaner removal',
    'a straighter tear', 'a wider roll'],
  /* software */
  'A photo editor': ['faster export', 'batch processing', 'better raw handling',
    'layer masks', 'one-click noise removal'],
  'A password manager': ['browser autofill', 'breach alerts', 'shared vaults',
    'passkey support', 'offline sync'],
  'An accounting package': ['bank feeds', 'recurring invoices', 'multi-currency',
    'better reports', 'a payroll module'],
  'A music production suite': ['lower latency', 'more instruments', 'time-stretching',
    'stem separation', 'cloud collaboration'],
  'Tax filing software': ['import from payroll', 'error checking', 'more forms',
    'refund tracking', 'multi-year import'],
  'A project scheduler': ['a dependency view', 'resource levelling', 'calendar sync',
    'baselines', 'a portfolio view'],
  'A VPN subscription': ['more locations', 'a faster protocol', 'split tunnelling',
    'a kill switch', 'an audited no-logs policy'],
  'A video editor': ['hardware acceleration', 'proxy editing', 'better colour tools',
    'motion tracking', 'multicam'],
  'A CAD package': ['faster rebuilds', 'parametric history', 'assembly constraints',
    'a simulation add-on', 'cloud rendering'],
  'A language course': ['speech feedback', 'spaced repetition', 'offline lessons',
    'native-speaker audio', 'conversation practice'],
  'A note-taking app': ['instant search', 'linked notes', 'handwriting',
    'a web clipper', 'end-to-end encryption'],
  'Backup software': ['incremental backups', 'versioning', 'faster restore',
    'cloud targets', 'ransomware detection'],
  'A statistics package': ['a faster solver', 'better charts', 'reproducible scripts',
    'mixed models', 'notebook export'],
  'A screen-recording tool': ['smaller files', 'system audio capture', 'editing trims',
    'a webcam overlay', 'automatic captions'],
  'A font library': ['more weights', 'variable fonts', 'better hinting',
    'wider language coverage', 'web licences'],
  /* deep tech */
  'Lidar modules': ['longer range', 'a tighter beam', 'a faster scan rate',
    'lower power draw', 'solid-state scanning'],
  'Glucose sensors': ['longer wear', 'a smaller footprint', 'less drift',
    'factory calibration', 'a lower detection limit'],
  'Solid-state battery cells': ['higher energy density', 'faster charging',
    'a wider temperature range', 'longer cycle life', 'a thinner separator'],
  'Fibre-optic transceivers': ['a higher line rate', 'lower power', 'longer reach',
    'tighter wavelength control', 'a smaller form factor'],
  'MEMS pressure sensors': ['lower drift', 'a wider range', 'a smaller die',
    'temperature compensation', 'a digital output'],
  'Water-testing cartridges': ['a faster result', 'a lower detection limit', 'more analytes',
    'a longer shelf life', 'field calibration'],
  'Thermal imaging cores': ['higher resolution', 'lower noise', 'a faster frame rate',
    'shutterless calibration', 'a smaller pixel pitch'],
  'RFID reader modules': ['longer read range', 'faster anti-collision', 'lower power',
    'wider frequency support', 'a smaller antenna'],
  'Ultrasonic flow meters': ['a wider flow range', 'better accuracy', 'bidirectional measurement',
    'clamp-on mounting', 'lower power'],
  'Air-quality sensors': ['better selectivity', 'a faster response', 'lower drift',
    'humidity compensation', 'a smaller package'],
  'Diagnostic cartridges': ['a faster assay', 'fewer steps', 'room-temperature storage',
    'a multiplexed panel', 'a lower sample volume'],
  'Piezoelectric actuators': ['a longer stroke', 'a faster response', 'lower hysteresis',
    'a higher blocking force', 'a smaller envelope'],
  'Fuel-cell stacks': ['higher power density', 'a faster cold start', 'longer stack life',
    'thinner plates', 'lower platinum loading'],
  'Radiation dosimeters': ['a wider dose range', 'a faster readout', 'lower energy dependence',
    'a smaller badge', 'wireless readout'],
  'GNSS positioning modules': ['a faster fix', 'multi-band reception', 'better multipath rejection',
    'lower power', 'centimetre corrections'],
};

/* Process research does not change the product; it changes the line that makes
   it. So these are about the factory, they are per KIND rather than per
   product, and the screen shows them somewhere else on purpose. */
export const PROCESS_STEPS = {
  hardware: ['a second assembly jig', 'tighter tolerances on the line', 'the rework station retired',
    'castings bought in bulk', 'an automated test rig'],
  commodity: ['a bigger run size', 'less waste per batch', 'a faster changeover',
    'a cheaper pallet spec', 'a second shift on the press'],
  software: ['a smaller build', 'fewer support tickets', 'a cheaper hosting tier',
    'automated release testing', 'a rewritten core loop'],
  deeptech: ['a higher-yield run', 'a faster burn-in', 'fewer hand steps',
    'a cheaper substrate', 'automated final test'],
};

/* A line's display name is either a catalogue product or one of its variants —
   a second line is another version of what you already make, so it inherits
   the same list. Anything unrecognised falls back to its kind's process words,
   which are true of any factory, rather than to silence. */
export function improvementsFor(kind, display) {
  if (display && IMPROVEMENTS[display]) return IMPROVEMENTS[display];
  const list = CATALOGUE[kind] || [];
  const parent = list.find((p) => p.name === display)
    || list.find((p) => (p.variants || []).includes(display));
  if (parent && IMPROVEMENTS[parent.name]) return IMPROVEMENTS[parent.name];
  return null;
}
