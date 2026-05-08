/**
 * Name list for --version+name. Deterministically picks a name based on the git commit hash.
 * Names are hyphenated to stay as a single semver prerelease identifier.
 *
 * Two pools: historical figures (~80%) and passive-aggressive food (~20%).
 * The commit hash determines which pool and which name you get.
 */

const names = [
    "julius-caesar",
    "marie-antoinette",
    "genghis-khan",
    "nikola-tesla",
    "marco-polo",
    "joan-of-arc",
    "ivan-the-terrible",
    "alexander-the-great",
    "leonardo-da-vinci",
    "isaac-newton",
    "charles-darwin",
    "albert-einstein",
    "napoleon-bonaparte",
    "william-shakespeare",
    "cleopatra-of-egypt",
    "galileo-galilei",
    "ludwig-van-beethoven",
    "queen-victoria",
    "attila-the-hun",
    "alexander-hamilton",
    "benjamin-franklin",
    "catherine-the-great",
    "elizabeth-the-first",
    "peter-the-great",
    "richard-the-lionheart",
    "frederick-the-great",
    "vlad-the-impaler",
    "erik-the-red",
    "william-the-conqueror",
    "philip-the-bold",
    "henry-the-eighth",
    "mary-queen-of-scots",
    "lorenzo-de-medici",
    "hernando-cortes",
    "vasco-da-gama",
    "ferdinand-magellan",
    "amerigo-vespucci",
    "hannibal-barca",
    "sun-tzu",
    "kublai-khan",
    "tamerlane-the-great",
    "ramesses-the-great",
    "leif-erikson",
    "ragnar-lothbrok",
    "boudicca-of-iceni",
    "spartacus-of-thrace",
    "pythagoras-of-samos",
    "archimedes-of-syracuse",
    "plato-of-athens",
    "socrates-of-athens",
    "aristotle-of-stagira",
    "hippocrates-of-kos",
    "nero-of-rome",
    "caligula-of-rome",
    "marcus-aurelius",
    "constantine-the-great",
    "charlemagne-of-franks",
    "saladin-of-egypt",
    "richard-the-third",
    "edward-the-confessor",
    "alfred-the-great",
    "sigmund-freud",
    "marie-curie",
    "ada-lovelace",
    "alan-turing",
    "niels-bohr",
    "max-planck",
    "werner-heisenberg",
    "erwin-schrodinger",
    "johannes-kepler",
    "nicolaus-copernicus",
    "tycho-brahe",
    "gregor-mendel",
    "louis-pasteur",
    "alexander-fleming",
    "thomas-edison",
    "alexander-graham-bell",
    "guglielmo-marconi",
    "wright-brothers",
];

const foodAdjectives = [
    "fine", "okay", "adequate", "mediocre", "acceptable",
    "reasonable", "interesting", "brave", "unique", "special",
    "notable", "decent", "tragic", "doomed", "chaotic",
    "dramatic", "epic", "humble", "bold", "curious",
    "meh", "suspicious", "questionable", "underwhelming", "bloody",
];

const tempers = [
    "moody", "grumpy", "sleepy", "anxious", "cheerful",
    "brooding", "restless", "cranky", "gloomy", "jolly",
    "furious", "melancholy", "smug", "paranoid", "rowdy",
    "sulky", "frantic", "stoic", "dramatic", "hangry",
];

const foods = [
    "burrito", "sauerkraut", "lasagna", "dumpling", "pretzel",
    "goulash", "tofu", "croissant", "pierogi", "schnitzel",
    "waffle", "falafel", "pancake", "muffin", "ramen",
    "tiramisu", "couscous", "gnocchi", "kimchi", "churro",
    "macaron", "wonton", "brioche", "biscotti", "turnip",
    "potato", "strudel", "risotto", "empanada", "tempura",
];

/**
 * Simple hash function that returns a positive integer from a string.
 * @param {string} str
 * @returns {number}
 */
function hashToNumber(str) {
    let num = 0;
    for (let i = 0; i < str.length; i++) {
        num = ((num << 5) - num + str.charCodeAt(i)) | 0;
    }
    return Math.abs(num);
}

/**
 * Picks a name deterministically based on a git commit hash.
 * The same hash will always produce the same name.
 * ~80% chance of a historical figure, ~20% chance of passive-aggressive food.
 * @param {string} hash - The git commit hash (short or full)
 * @returns {string} A hyphenated name
 */
export function getVersionName(hash) {
    const num = hashToNumber(hash);
    const isFood = (num % 5) === 0; // ~20% chance
    if (isFood) {
        const adj = foodAdjectives[num % foodAdjectives.length];
        const food = foods[Math.floor(num / foodAdjectives.length) % foods.length];
        return `${adj}-${food}`;
    }
    const name = names[num % names.length];
    const hasMood = (num % 3) === 0; // ~33% of historical names get a temper
    if (hasMood) {
        const temper = tempers[Math.floor(num / names.length) % tempers.length];
        return `${temper}-${name}`;
    }
    return name;
}
