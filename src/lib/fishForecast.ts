export interface FishingWeatherInput {
  temp: number;
  humidity: number;
  pressure: number;
  windSpeed: number;
  description?: string;
}

export interface FishRecommendation {
  id: string;
  name: string;
  subtitle: string;
  chance: number;
  badge: string;
  why: string;
  tip: string;
}

interface FishProfile {
  id: string;
  name: string;
  subtitle: string;
  dominant?: boolean;
  tip: string;
  score: (weather: FishingWeatherInput, tags: WeatherTags) => { value: number; why: string };
}

interface WeatherTags {
  clear: boolean;
  cloudy: boolean;
  rain: boolean;
  storm: boolean;
  dawn: boolean;
  day: boolean;
  dusk: boolean;
  night: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text?: string) {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getWeatherTags(description?: string): WeatherTags {
  const normalized = normalizeText(description);
  const hour = new Date().getHours();

  return {
    clear: /senin|clear|sun|soare/.test(normalized),
    cloudy: /nori|innorat|noros|cloud|overcast|partly/.test(normalized),
    rain: /ploaie|averse|drizzle|rain|shower/.test(normalized),
    storm: /furtuna|storm|thunder/.test(normalized),
    dawn: hour >= 5 && hour < 9,
    day: hour >= 9 && hour < 18,
    dusk: hour >= 18 && hour < 22,
    night: hour >= 22 || hour < 5,
  };
}

function chanceBadge(chance: number) {
  if (chance >= 78) return 'Foarte bun';
  if (chance >= 62) return 'Bun';
  if (chance >= 45) return 'Mediu';
  return 'Slab';
}

type ForecastLanguage = 'ro' | 'en';

const forecastEnMap: Record<string, string> = {
  'Foarte bun': 'Very good',
  Bun: 'Good',
  Mediu: 'Average',
  Slab: 'Low',
  Crap: 'Carp',
  Caras: 'Crucian carp',
  'Plătică': 'Bream',
  Amur: 'Grass carp',
  Lin: 'Tench',
  Somn: 'Catfish',
  'Șalău': 'Zander',
  Biban: 'Perch',
  Clean: 'Chub',
  'Mreană': 'Barbel',
  'Știucă': 'Pike',
  Avat: 'Asp',
  'Roșioară': 'Rudd',
  'Babușcă': 'Roach',
  Oblete: 'Bleak',
  'Specie dominantă pe bălți și lacuri din România': 'Dominant species in Romanian ponds and lakes',
  'Foarte comun și tolerant la variații de apă și oxigen': 'Very common and tolerant to water and oxygen variation',
  'Specie frecventă pe ape line și lacuri bogate în hrană': 'Common in calm waters and food-rich lakes',
  'Mai bun pe apă caldă și perioade stabile': 'Better in warm water and stable periods',
  'Specie discretă, bună pe apă caldă și vreme liniștită': 'Subtle species, good in warm water and calm weather',
  'Prădător de apă caldă, foarte bun la lumină slabă': 'Warm-water predator, very good in low light',
  'Prădător bun pe lumină slabă și apă ușor tulbure': 'Good predator in low light and slightly stained water',
  'Activ pe schimbări de lumină și pe vreme moderată': 'Active on light changes and in moderate weather',
  'Foarte activ în ape curgătoare și pe schimbări de lumină': 'Very active in flowing waters and during light changes',
  'Specie puternică de râu, activă pe apă oxigenată și stabilă': 'Strong river species, active in oxygenated and stable water',
  'Mai bună pe temperaturi mai reci și lumină difuză': 'Better in cooler temperatures and diffused light',
  'Prădător rapid, foarte bun pe lumină bună și apă în mișcare': 'Fast predator, very good in good light and moving water',
  'Specie foarte comună, activă pe vreme blândă și apă mai caldă': 'Very common species, active in mild weather and warmer water',
  'Specie comună pe ape line, destul de constantă pe vreme moderată': 'Common species in calm waters, fairly steady in moderate weather',
  'Foarte activ la suprafață, mai ales pe vreme stabilă și lumină bună': 'Very active near the surface, especially in stable weather and good light',
  'Încearcă porumb, boilies dulci sau fishmeal, mai ales dimineața și spre seară.': 'Try corn, sweet boilies or fishmeal, especially in the morning and toward evening.',
  'Merg bine momelile simple: vierme, porumb, pâine sau pellet mic.': 'Simple baits work well: worm, corn, bread or small pellets.',
  'Nadă fină, viermi și porumb dulce pe apă mai liniștită.': 'Fine groundbait, worms and sweet corn work well in calmer water.',
  'Caută-l pe apă încălzită, cu porumb, iarbă sau momeli vegetale.': 'Look for it in warmed water with corn, grass or plant-based baits.',
  'Caută-l aproape de vegetație, cu vierme, porumb sau momeli fine pe substrat moale.': 'Look for it near vegetation, with worm, corn or fine baits on soft bottom.',
  'Cele mai bune ferestre sunt seara și noaptea, pe pește viu sau momeli mari.': 'The best windows are evening and night, on live bait or large baits.',
  'Caută-l pe twilight, cu shad-uri, voblere discrete sau peștișor.': 'Look for it at twilight, with shads, subtle wobblers or small live bait.',
  'Rotative mici, năluci soft și vierme când stă aproape de mal.': 'Small spinners, soft lures and worm work when it stays close to shore.',
  'Merg bine insecte, pâine, voblere mici și năluci rapide aproape de curent.': 'Insects, bread, small wobblers and fast lures work well near current.',
  'Pe râuri merg bine brânză, viermi, boabe și monturi ținute pe substrat.': 'On rivers, cheese, worms, grains and bottom-presented rigs work well.',
  'Pe apă mai rece încearcă voblere, spinnerbait sau pește viu.': 'In colder water, try wobblers, spinnerbaits or live bait.',
  'Caută-l în zone cu peștișor, pe năluci rapide, oscilante și voblere de suprafață.': 'Look for it where baitfish gather, using fast lures, spoons and topwater wobblers.',
  'Bună pe momeli mici, pâine, vierme și monturi fine aproape de mal.': 'Good on small baits, bread, worm and fine rigs close to shore.',
  'Folosește monturi fine, vierme sau momeală mică vegetală pe nadă discretă.': 'Use fine rigs, worm or small plant-based bait over subtle groundbait.',
  'Monturi ultra-fine și momeli mici, aproape de suprafață sau în apă deschisă.': 'Use ultra-fine rigs and small baits near the surface or in open water.',
  'temperatura este foarte bună pentru hrănire activă': 'the temperature is very good for active feeding',
  'temperatura este încă acceptabilă pentru crap': 'the temperature is still acceptable for carp',
  'temperatura îl face mai lent': 'the temperature makes it less active',
  'lumina mai moale îl scoate mai ușor la hrană': 'softer light brings it out to feed more easily',
  'presiunea e într-o zonă stabilă': 'the pressure is in a stable range',
  'vântul moderat poate activa zona de mal': 'moderate wind can activate the shoreline area',
  'ora favorizează mișcarea crapului': 'the time of day favors carp movement',
  'soarele tare din miezul zilei îl poate ține jos': 'strong midday sun can keep it lower in the water',
  'temperatura îi susține activitatea constantă': 'the temperature supports its steady activity',
  'apa prea rece reduce mult hrănirea': 'water that is too cold greatly reduces feeding',
  'vremea mai moale îl ține aproape de hrană': 'milder weather keeps it close to feeding areas',
  'vântul nu este deranjant pentru zonele lui de hrănire': 'the wind is not disruptive for its feeding areas',
  'specie foarte adaptabilă la condiții variate': 'a species that adapts very well to varied conditions',
  'temperatura e aproape ideală pentru plătică': 'the temperature is nearly ideal for bream',
  'cerul acoperit îi crește încrederea la hrănire': 'cloud cover increases its confidence to feed',
  'vântul moderat poate concentra hrana naturală': 'moderate wind can concentrate natural food',
  'intervalul orar o avantajează': 'the time window favors it',
  'apa prea caldă o poate muta mai jos': 'water that is too warm can push it deeper',
  'apa caldă îl favorizează clar': 'warm water clearly favors it',
  'apa rece îl taie serios din activitate': 'cold water seriously cuts its activity',
  'condițiile luminoase și calde îl ajută': 'bright and warm conditions help it',
  'presiunea pare stabilă': 'the pressure looks stable',
  'instabilitatea puternică nu îl ajută': 'strong instability does not help it',
  'temperatura este potrivită pentru lin': 'the temperature suits tench well',
  'apa rece îl ține mai puțin activ': 'cold water keeps it less active',
  'apa mai liniștită îl avantajează': 'calmer water suits it better',
  'dimineața și seara ies mai des la hrană': 'morning and evening are when it feeds more often',
  'lumina redusă îl face mai încrezător': 'lower light makes it more confident',
  'apa suficient de caldă îl activează': 'sufficiently warm water activates it',
  'apa rece scade puternic activitatea': 'cold water sharply reduces activity',
  'intervalul e foarte bun pentru somn': 'this time window is very good for catfish',
  'lumina slabă și vremea moale îl avantajează': 'low light and mild weather favor it',
  'presiunea mai joasă poate activa prădătorii': 'lower pressure can activate predators',
  'ziua senină îl împinge spre zone mai adânci': 'a clear day pushes it toward deeper areas',
  'temperatura e potrivită pentru șalău': 'the temperature suits zander',
  'apa prea caldă îl face mai selectiv': 'water that is too warm makes it more selective',
  'vizibilitatea redusă îl ajută la atac': 'reduced visibility helps it strike',
  'perioada cu lumină slabă este excelentă': 'the low-light period is excellent',
  'mișcarea apei poate urca peștii mici': 'water movement can lift small baitfish',
  'lumina puternică îl ține mai rezervat': 'strong light keeps it more cautious',
  'temperatura îl ține activ': 'the temperature keeps it active',
  'vântul moderat poate aduna bancurile de hrană': 'moderate wind can gather schools of food fish',
  'lumina mai moale îl avantajează': 'softer light favors it',
  'apa foarte caldă îl poate muta mai jos': 'very warm water can push it deeper',
  'temperatura îl ține activ la hrană': 'the temperature keeps it actively feeding',
  'lumina mai moale ajută cleanul să urce la suprafață': 'softer light helps chub rise to the surface',
  'mișcarea apei poate aduce hrană naturală': 'water movement can bring natural food',
  'soarele puternic îl poate face suspicios': 'strong sun can make it cautious',
  'temperatura este bună pentru mreană': 'the temperature is good for barbel',
  'presiunea stabilă îi favorizează patrularea': 'stable pressure favors its patrol behavior',
  'vremea mai moale poate stimula hrănirea': 'milder weather can stimulate feeding',
  'apa prea încălzită nu este ideală': 'overheated water is not ideal',
  'temperatura este foarte bună pentru știucă': 'the temperature is very good for pike',
  'apa prea caldă nu o ajută': 'water that is too warm does not help it',
  'vremea închisă îi dă avantaj la ambuscadă': 'overcast weather gives it an ambush advantage',
  'apa mișcată poate activa atacurile': 'moving water can trigger strikes',
  'temperatura îl ține în zona de atac': 'the temperature keeps it in the strike zone',
  'lumina bună îl ajută să vâneze': 'good light helps it hunt',
  'apa mișcată poate rupe bancurile de oblete': 'moving water can break up bleak schools',
  'condițiile prea întunecate îl dezavantajează': 'conditions that are too dark work against it',
  'temperatura este bună pentru specie': 'the temperature is good for the species',
  'apele mai calme îi convin': 'calmer waters suit it',
  'se hrănește bine pe parcursul zilei': 'it feeds well through the day',
  'apa prea rece o încetinește mult': 'water that is too cold slows it down a lot',
  'temperatura este favorabilă': 'the temperature is favorable',
  'vremea moale o ține activă': 'mild weather keeps it active',
  'presiunea este relativ stabilă': 'the pressure is relatively stable',
  'vântul puternic poate deranja zonele ei de hrănire': 'strong wind can disturb its feeding areas',
  'apa caldă îi susține activitatea la suprafață': 'warm water supports its surface activity',
  'lumina bună îl face ușor de găsit în stratul superior': 'good light makes it easy to find in the upper layer',
  'suprafața mai calmă îl avantajează': 'a calmer surface favors it',
  'instabilitatea puternică îi sparge comportamentul de banc': 'strong instability breaks up its schooling behavior',
  'Condițiile actuale îl păstrează în zona de interes.': 'Current conditions keep it in the target zone.',
};

function localizeForecastText(value: string, language: ForecastLanguage) {
  if (language === 'ro') return value;
  return forecastEnMap[value] ?? value;
}

const fishProfiles: FishProfile[] = [
  {
    id: 'crap',
    name: 'Crap',
    subtitle: 'Specie dominantă pe bălți și lacuri din România',
    dominant: true,
    tip: 'Încearcă porumb, boilies dulci sau fishmeal, mai ales dimineața și spre seară.',
    score: (weather, tags) => {
      let value = 72;
      const reasons: string[] = [];

      if (weather.temp >= 18 && weather.temp <= 28) {
        value += 14;
        reasons.push('temperatura este foarte bună pentru hrănire activă');
      } else if (weather.temp >= 12 && weather.temp < 18) {
        value += 6;
        reasons.push('temperatura este încă acceptabilă pentru crap');
      } else if (weather.temp > 30 || weather.temp < 8) {
        value -= 12;
        reasons.push('temperatura îl face mai lent');
      }

      if (tags.cloudy || tags.rain) {
        value += 7;
        reasons.push('lumina mai moale îl scoate mai ușor la hrană');
      }

      if (weather.pressure >= 1008 && weather.pressure <= 1020) {
        value += 5;
        reasons.push('presiunea e într-o zonă stabilă');
      }

      if (weather.windSpeed >= 8 && weather.windSpeed <= 22) {
        value += 4;
        reasons.push('vântul moderat poate activa zona de mal');
      }

      if (tags.dawn || tags.dusk || tags.night) {
        value += 6;
        reasons.push('ora favorizează mișcarea crapului');
      }

      if (tags.clear && tags.day && weather.temp > 27) {
        value -= 7;
        reasons.push('soarele tare din miezul zilei îl poate ține jos');
      }

      return { value, why: reasons.join(', ') };
    },
  },
  {
    id: 'caras',
    name: 'Caras',
    subtitle: 'Foarte comun și tolerant la variații de apă și oxigen',
    dominant: true,
    tip: 'Merg bine momelile simple: vierme, porumb, pâine sau pellet mic.',
    score: (weather, tags) => {
      let value = 68;
      const reasons: string[] = [];

      if (weather.temp >= 14 && weather.temp <= 27) {
        value += 10;
        reasons.push('temperatura îi susține activitatea constantă');
      } else if (weather.temp < 6) {
        value -= 10;
        reasons.push('apa prea rece reduce mult hrănirea');
      }

      if (tags.cloudy || tags.rain) {
        value += 4;
        reasons.push('vremea mai moale îl ține aproape de hrană');
      }

      if (weather.windSpeed <= 18) {
        value += 4;
        reasons.push('vântul nu este deranjant pentru zonele lui de hrănire');
      }

      if (weather.pressure < 1005 || weather.pressure > 1023) {
        value -= 2;
      } else {
        value += 3;
      }

      return { value, why: reasons.join(', ') || 'specie foarte adaptabilă la condiții variate' };
    },
  },
  {
    id: 'platica',
    name: 'Plătică',
    subtitle: 'Specie frecventă pe ape line și lacuri bogate în hrană',
    dominant: true,
    tip: 'Nadă fină, viermi și porumb dulce pe apă mai liniștită.',
    score: (weather, tags) => {
      let value = 60;
      const reasons: string[] = [];

      if (weather.temp >= 14 && weather.temp <= 24) {
        value += 10;
        reasons.push('temperatura e aproape ideală pentru plătică');
      }

      if (tags.cloudy) {
        value += 6;
        reasons.push('cerul acoperit îi crește încrederea la hrănire');
      }

      if (weather.windSpeed >= 6 && weather.windSpeed <= 18) {
        value += 3;
        reasons.push('vântul moderat poate concentra hrana naturală');
      }

      if (tags.dawn || tags.dusk) {
        value += 4;
        reasons.push('intervalul orar o avantajează');
      }

      if (weather.temp > 29) {
        value -= 8;
        reasons.push('apa prea caldă o poate muta mai jos');
      }

      return { value, why: reasons.join(', ') };
    },
  },
  {
    id: 'amur',
    name: 'Amur',
    subtitle: 'Mai bun pe apă caldă și perioade stabile',
    tip: 'Caută-l pe apă încălzită, cu porumb, iarbă sau momeli vegetale.',
    score: (weather, tags) => {
      let value = 52;
      const reasons: string[] = [];

      if (weather.temp >= 20 && weather.temp <= 30) {
        value += 16;
        reasons.push('apa caldă îl favorizează clar');
      } else if (weather.temp < 14) {
        value -= 14;
        reasons.push('apa rece îl taie serios din activitate');
      }

      if (tags.clear || tags.day) {
        value += 5;
        reasons.push('condițiile luminoase și calde îl ajută');
      }

      if (weather.pressure >= 1010 && weather.pressure <= 1022) {
        value += 4;
        reasons.push('presiunea pare stabilă');
      }

      if (tags.storm) {
        value -= 8;
        reasons.push('instabilitatea puternică nu îl ajută');
      }

      return { value, why: reasons.join(', ') };
    },
  },
  {
    id: 'lin',
    name: 'Lin',
    subtitle: 'Specie discretă, bună pe apă caldă și vreme liniștită',
    tip: 'Caută-l aproape de vegetație, cu vierme, porumb sau momeli fine pe substrat moale.',
    score: (weather, tags) => {
      let value = 49;
      const reasons: string[] = [];

      if (weather.temp >= 16 && weather.temp <= 26) {
        value += 12;
        reasons.push('temperatura este potrivită pentru lin');
      } else if (weather.temp < 10) {
        value -= 12;
        reasons.push('apa rece îl ține mai puțin activ');
      }

      if (weather.windSpeed <= 14) {
        value += 7;
        reasons.push('apa mai liniștită îl avantajează');
      }

      if (tags.dawn || tags.dusk) {
        value += 8;
        reasons.push('dimineața și seara ies mai des la hrană');
      }

      if (tags.rain || tags.cloudy) {
        value += 3;
        reasons.push('lumina redusă îl face mai încrezător');
      }

      return { value, why: reasons.join(', ') };
    },
  },
  {
    id: 'somn',
    name: 'Somn',
    subtitle: 'Prădător de apă caldă, foarte bun la lumină slabă',
    tip: 'Cele mai bune ferestre sunt seara și noaptea, pe pește viu sau momeli mari.',
    score: (weather, tags) => {
      let value = 48;
      const reasons: string[] = [];

      if (weather.temp >= 20) {
        value += 14;
        reasons.push('apa suficient de caldă îl activează');
      } else if (weather.temp < 12) {
        value -= 14;
        reasons.push('apa rece scade puternic activitatea');
      }

      if (tags.dusk || tags.night) {
        value += 16;
        reasons.push('intervalul e foarte bun pentru somn');
      }

      if (tags.cloudy || tags.rain) {
        value += 8;
        reasons.push('lumina slabă și vremea moale îl avantajează');
      }

      if (weather.pressure < 1008) {
        value += 5;
        reasons.push('presiunea mai joasă poate activa prădătorii');
      }

      if (tags.clear && tags.day) {
        value -= 10;
        reasons.push('ziua senină îl împinge spre zone mai adânci');
      }

      return { value, why: reasons.join(', ') };
    },
  },
  {
    id: 'salau',
    name: 'Șalău',
    subtitle: 'Prădător bun pe lumină slabă și apă ușor tulbure',
    tip: 'Caută-l pe twilight, cu shad-uri, voblere discrete sau peștișor.',
    score: (weather, tags) => {
      let value = 47;
      const reasons: string[] = [];

      if (weather.temp >= 12 && weather.temp <= 22) {
        value += 9;
        reasons.push('temperatura e potrivită pentru șalău');
      } else if (weather.temp > 27) {
        value -= 6;
        reasons.push('apa prea caldă îl face mai selectiv');
      }

      if (tags.cloudy || tags.rain) {
        value += 10;
        reasons.push('vizibilitatea redusă îl ajută la atac');
      }

      if (tags.dusk || tags.night || tags.dawn) {
        value += 12;
        reasons.push('perioada cu lumină slabă este excelentă');
      }

      if (weather.windSpeed >= 10 && weather.windSpeed <= 24) {
        value += 4;
        reasons.push('mișcarea apei poate urca peștii mici');
      }

      if (tags.clear && tags.day) {
        value -= 8;
        reasons.push('lumina puternică îl ține mai rezervat');
      }

      return { value, why: reasons.join(', ') };
    },
  },
  {
    id: 'biban',
    name: 'Biban',
    subtitle: 'Activ pe schimbări de lumină și pe vreme moderată',
    tip: 'Rotative mici, năluci soft și vierme când stă aproape de mal.',
    score: (weather, tags) => {
      let value = 50;
      const reasons: string[] = [];

      if (weather.temp >= 10 && weather.temp <= 22) {
        value += 9;
        reasons.push('temperatura îl ține activ');
      }

      if (weather.windSpeed >= 8 && weather.windSpeed <= 20) {
        value += 4;
        reasons.push('vântul moderat poate aduna bancurile de hrană');
      }

      if (tags.cloudy || tags.dawn || tags.dusk) {
        value += 5;
        reasons.push('lumina mai moale îl avantajează');
      }

      if (weather.temp > 28) {
        value -= 7;
        reasons.push('apa foarte caldă îl poate muta mai jos');
      }

      return { value, why: reasons.join(', ') || 'specie oportunistă, dar mai bună pe vreme moderată' };
    },
  },
  {
    id: 'clean',
    name: 'Clean',
    subtitle: 'Foarte activ în ape curgătoare și pe schimbări de lumină',
    tip: 'Merg bine insecte, pâine, voblere mici și năluci rapide aproape de curent.',
    score: (weather, tags) => {
      let value = 52;
      const reasons: string[] = [];

      if (weather.temp >= 12 && weather.temp <= 24) {
        value += 10;
        reasons.push('temperatura îl ține activ la hrană');
      }

      if (tags.cloudy || tags.dawn || tags.dusk) {
        value += 7;
        reasons.push('lumina mai moale ajută cleanul să urce la suprafață');
      }

      if (weather.windSpeed >= 6 && weather.windSpeed <= 20) {
        value += 3;
        reasons.push('mișcarea apei poate aduce hrană naturală');
      }

      if (tags.clear && tags.day && weather.temp > 26) {
        value -= 7;
        reasons.push('soarele puternic îl poate face suspicios');
      }

      return { value, why: reasons.join(', ') };
    },
  },
  {
    id: 'mreana',
    name: 'Mreană',
    subtitle: 'Specie puternică de râu, activă pe apă oxigenată și stabilă',
    tip: 'Pe râuri merg bine brânză, viermi, boabe și monturi ținute pe substrat.',
    score: (weather, tags) => {
      let value = 50;
      const reasons: string[] = [];

      if (weather.temp >= 13 && weather.temp <= 23) {
        value += 9;
        reasons.push('temperatura este bună pentru mreană');
      }

      if (weather.pressure >= 1008 && weather.pressure <= 1022) {
        value += 5;
        reasons.push('presiunea stabilă îi favorizează patrularea');
      }

      if (weather.windSpeed >= 6 && weather.windSpeed <= 18) {
        value += 2;
      }

      if (tags.cloudy || tags.rain) {
        value += 5;
        reasons.push('vremea mai moale poate stimula hrănirea');
      }

      if (weather.temp > 28) {
        value -= 9;
        reasons.push('apa prea încălzită nu este ideală');
      }

      return { value, why: reasons.join(', ') || 'merge mai bine pe condiții destul de stabile' };
    },
  },
  {
    id: 'stiuca',
    name: 'Știucă',
    subtitle: 'Mai bună pe temperaturi mai reci și lumină difuză',
    tip: 'Pe apă mai rece încearcă voblere, spinnerbait sau pește viu.',
    score: (weather, tags) => {
      let value = 46;
      const reasons: string[] = [];

      if (weather.temp >= 8 && weather.temp <= 18) {
        value += 12;
        reasons.push('temperatura este foarte bună pentru știucă');
      } else if (weather.temp > 24) {
        value -= 12;
        reasons.push('apa prea caldă nu o ajută');
      }

      if (tags.cloudy || tags.rain) {
        value += 6;
        reasons.push('vremea închisă îi dă avantaj la ambuscadă');
      }

      if (weather.windSpeed >= 10 && weather.windSpeed <= 22) {
        value += 4;
        reasons.push('apa mișcată poate activa atacurile');
      }

      if (tags.day || tags.dawn) {
        value += 3;
      }

      return { value, why: reasons.join(', ') };
    },
  },
  {
    id: 'avat',
    name: 'Avat',
    subtitle: 'Prădător rapid, foarte bun pe lumină bună și apă în mișcare',
    tip: 'Caută-l în zone cu peștișor, pe năluci rapide, oscilante și voblere de suprafață.',
    score: (weather, tags) => {
      let value = 44;
      const reasons: string[] = [];

      if (weather.temp >= 12 && weather.temp <= 24) {
        value += 9;
        reasons.push('temperatura îl ține în zona de atac');
      }

      if (tags.day || tags.dawn) {
        value += 8;
        reasons.push('lumina bună îl ajută să vâneze');
      }

      if (weather.windSpeed >= 8 && weather.windSpeed <= 24) {
        value += 6;
        reasons.push('apa mișcată poate rupe bancurile de oblete');
      }

      if (tags.storm || tags.night) {
        value -= 8;
        reasons.push('condițiile prea întunecate îl dezavantajează');
      }

      return { value, why: reasons.join(', ') };
    },
  },
  {
    id: 'rosioara',
    name: 'Roșioară',
    subtitle: 'Specie foarte comună, activă pe vreme blândă și apă mai caldă',
    dominant: true,
    tip: 'Bună pe momeli mici, pâine, vierme și monturi fine aproape de mal.',
    score: (weather, tags) => {
      let value = 56;
      const reasons: string[] = [];

      if (weather.temp >= 14 && weather.temp <= 26) {
        value += 9;
        reasons.push('temperatura este bună pentru specie');
      }

      if (weather.windSpeed <= 18) {
        value += 4;
        reasons.push('apele mai calme îi convin');
      }

      if (tags.clear || tags.cloudy) {
        value += 3;
      }

      if (tags.day || tags.dawn || tags.dusk) {
        value += 4;
        reasons.push('se hrănește bine pe parcursul zilei');
      }

      if (weather.temp < 7) {
        value -= 10;
        reasons.push('apa prea rece o încetinește mult');
      }

      return { value, why: reasons.join(', ') || 'specie prezentă des și destul de constantă' };
    },
  },
  {
    id: 'babusca',
    name: 'Babușcă',
    subtitle: 'Specie comună pe ape line, destul de constantă pe vreme moderată',
    dominant: true,
    tip: 'Folosește monturi fine, vierme sau momeală mică vegetală pe nadă discretă.',
    score: (weather, tags) => {
      let value = 55;
      const reasons: string[] = [];

      if (weather.temp >= 10 && weather.temp <= 22) {
        value += 9;
        reasons.push('temperatura este favorabilă');
      }

      if (tags.cloudy || tags.rain) {
        value += 5;
        reasons.push('vremea moale o ține activă');
      }

      if (weather.pressure >= 1007 && weather.pressure <= 1020) {
        value += 4;
        reasons.push('presiunea este relativ stabilă');
      }

      if (weather.windSpeed > 24) {
        value -= 5;
        reasons.push('vântul puternic poate deranja zonele ei de hrănire');
      }

      return { value, why: reasons.join(', ') || 'specie destul de predictibilă în condiții moderate' };
    },
  },
  {
    id: 'oblete',
    name: 'Oblete',
    subtitle: 'Foarte activ la suprafață, mai ales pe vreme stabilă și lumină bună',
    dominant: true,
    tip: 'Monturi ultra-fine și momeli mici, aproape de suprafață sau în apă deschisă.',
    score: (weather, tags) => {
      let value = 53;
      const reasons: string[] = [];

      if (weather.temp >= 15 && weather.temp <= 28) {
        value += 10;
        reasons.push('apa caldă îi susține activitatea la suprafață');
      }

      if (tags.clear || tags.day) {
        value += 6;
        reasons.push('lumina bună îl face ușor de găsit în stratul superior');
      }

      if (weather.windSpeed <= 16) {
        value += 3;
        reasons.push('suprafața mai calmă îl avantajează');
      }

      if (tags.storm) {
        value -= 7;
        reasons.push('instabilitatea puternică îi sparge comportamentul de banc');
      }

      return { value, why: reasons.join(', ') };
    },
  },
];

export function buildFishForecast(weather: FishingWeatherInput, language: ForecastLanguage = 'ro'): FishRecommendation[] {
  const tags = getWeatherTags(weather.description);

  return fishProfiles
    .map((profile) => {
      const result = profile.score(weather, tags);
      const dominantBoost = profile.dominant ? 3 : 0;
      const chance = clamp(Math.round(result.value + dominantBoost), 12, 96);

      return {
        id: profile.id,
        name: localizeForecastText(profile.name, language),
        subtitle: localizeForecastText(profile.subtitle, language),
        chance,
        badge: localizeForecastText(chanceBadge(chance), language),
        why: localizeForecastText(result.why || 'Condițiile actuale îl păstrează în zona de interes.', language),
        tip: localizeForecastText(profile.tip, language),
      };
    })
    .sort((left, right) => right.chance - left.chance);
}