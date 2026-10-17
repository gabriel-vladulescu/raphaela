import type { BannerStyle } from '@/seed/banners';

// ---------- Accounts (password for all: parola123) ----------
export const SEED_PASSWORD = 'parola123';

interface SeedAccount {
  key: string;
  name: string;
  email: string;
  role: 'member' | 'author' | 'owner';
  occupation?: string;
  quote?: string;
}

export const ACCOUNTS = [
  {
    key: 'andreea',
    name: 'Andreea Stelar',
    email: 'andreea@seed.local',
    role: 'owner',
    occupation: 'Astrolog',
    quote: 'Stelele nu ne aleg drumul, dar ne luminează pașii.',
  },
  {
    key: 'victor',
    name: 'Victor Solaris',
    email: 'victor@seed.local',
    role: 'author',
    occupation: 'Astrolog și scriitor',
    quote: 'Cerul e o hartă. Drumul îl alegem noi.',
  },
  { key: 'mihai', name: 'Mihai Popescu', email: 'mihai@seed.local', role: 'member' },
  { key: 'ioana', name: 'Ioana Marin', email: 'ioana@seed.local', role: 'member' },
  { key: 'elena', name: 'Elena Dobre', email: 'elena@seed.local', role: 'member' },
  { key: 'radu', name: 'Radu Ionescu', email: 'radu@seed.local', role: 'member' },
  { key: 'bianca', name: 'Bianca Stan', email: 'bianca@seed.local', role: 'member' },
] as const satisfies readonly SeedAccount[];

export type AccountKey = (typeof ACCOUNTS)[number]['key'];

export const profileOf = (account: SeedAccount) => ({ occupation: account.occupation ?? null, quote: account.quote ?? null });

// ---------- Categories (3 levels: zodiac -> element -> sign) ----------
export interface SeedCategory {
  key: string;
  name: string;
  icon?: string;
  description?: string;
  children?: SeedCategory[];
}

const t = (glyph: string) => `${glyph}︎`; // text (not emoji) presentation

export const CATEGORIES: SeedCategory[] = [
  {
    key: 'zodii',
    name: 'Zodii',
    icon: t('♈'),
    description: 'Profiluri, compatibilități și sfaturi pentru fiecare semn zodiacal.',
    children: [
      {
        key: 'foc',
        name: 'Zodii de Foc',
        icon: '🜂',
        description: 'Berbec, Leu și Săgetător: entuziasm, curaj și inițiativă.',
        children: [
          { key: 'berbec', name: 'Berbec', icon: t('♈') },
          { key: 'leu', name: 'Leu', icon: t('♌') },
          { key: 'sagetator', name: 'Săgetător', icon: t('♐') },
        ],
      },
      {
        key: 'pamant',
        name: 'Zodii de Pământ',
        icon: '🜃',
        description: 'Taur, Fecioară și Capricorn: răbdare, stabilitate și simț practic.',
        children: [
          { key: 'taur', name: 'Taur', icon: t('♉') },
          { key: 'fecioara', name: 'Fecioară', icon: t('♍') },
          { key: 'capricorn', name: 'Capricorn', icon: t('♑') },
        ],
      },
      {
        key: 'aer',
        name: 'Zodii de Aer',
        icon: '🜁',
        description: 'Gemeni, Balanță și Vărsător: idei, comunicare și libertate.',
        children: [
          { key: 'gemeni', name: 'Gemeni', icon: t('♊') },
          { key: 'balanta', name: 'Balanță', icon: t('♎') },
          { key: 'varsator', name: 'Vărsător', icon: t('♒') },
        ],
      },
      {
        key: 'apa',
        name: 'Zodii de Apă',
        icon: '🜄',
        description: 'Rac, Scorpion și Pești: emoție, intuiție și profunzime.',
        children: [
          { key: 'rac', name: 'Rac', icon: t('♋') },
          { key: 'scorpion', name: 'Scorpion', icon: t('♏') },
          { key: 'pesti', name: 'Pești', icon: t('♓') },
        ],
      },
    ],
  },
  {
    key: 'planete',
    name: 'Planete',
    icon: t('☉'),
    description: 'Ce înseamnă fiecare planetă în harta ta natală.',
    children: [
      { key: 'soare', name: 'Soarele', icon: t('☉') },
      { key: 'luna', name: 'Luna', icon: t('☽') },
      { key: 'mercur', name: 'Mercur', icon: t('☿') },
      { key: 'venus', name: 'Venus', icon: t('♀') },
      { key: 'marte', name: 'Marte', icon: t('♂') },
      { key: 'jupiter', name: 'Jupiter', icon: t('♃') },
      { key: 'saturn', name: 'Saturn', icon: t('♄') },
    ],
  },
  { key: 'faze', name: 'Fazele Lunii', icon: t('☾'), description: 'Luna nouă, Luna plină și ritmul lunar al intențiilor.' },
  {
    key: 'horoscop',
    name: 'Horoscop',
    icon: t('★'),
    description: 'Previziuni zilnice, săptămânale, lunare și anuale.',
    children: [
      { key: 'zilnic', name: 'Zilnic', icon: '✦' },
      { key: 'saptamanal', name: 'Săptămânal', icon: '✧' },
      { key: 'lunar', name: 'Lunar', icon: t('☾') },
      { key: 'anual', name: 'Anual', icon: '✶' },
    ],
  },
  { key: 'compatibilitate', name: 'Compatibilitate', icon: '⚹', description: 'Cum se potrivesc semnele în dragoste și prietenie.' },
  { key: 'tranzite', name: 'Tranzite', icon: '☊', description: 'Mișcările planetelor și cum ne influențează.' },
  { key: 'ghiduri', name: 'Ghiduri', icon: '✧', description: 'Astrologie pentru începători, pas cu pas.' },
];

// ---------- HTML helpers ----------
const p = (text: string) => `<p>${text}</p>`;
const center = (text: string) => `<p style="text-align: center">${text}</p>`;
const h2 = (text: string) => `<h2>${text}</h2>`;
const h3 = (text: string) => `<h3>${text}</h3>`;
const ul = (...items: string[]) => `<ul>${items.map((item) => `<li><p>${item}</p></li>`).join('')}</ul>`;
const ol = (...items: string[]) => `<ol>${items.map((item) => `<li><p>${item}</p></li>`).join('')}</ol>`;
const quote = (text: string) => `<blockquote><p>${text}</p></blockquote>`;
const mark = (text: string, color = '#fff3a3') => `<mark data-color="${color}" style="background-color: ${color}; color: inherit">${text}</mark>`;
const hr = '<hr>';
const tasks = (...items: [string, boolean][]) =>
  `<ul data-type="taskList">${items
    .map(
      ([text, done]) =>
        `<li data-type="taskItem" data-checked="${done}"><label><input type="checkbox"${done ? ' checked="checked"' : ''}><span></span></label><div><p>${text}</p></div></li>`,
    )
    .join('')}</ul>`;
const table = (head: string[], ...rows: string[][]) =>
  `<table><tbody><tr>${head.map((cell) => `<th><p>${cell}</p></th>`).join('')}</tr>${rows
    .map((row) => `<tr>${row.map((cell) => `<td><p>${cell}</p></td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;

// ---------- Banner palettes ----------
const NIGHT: BannerStyle['sky'] = ['#0b1236', '#1b1150', '#2a0f3f'];
const banners = {
  moon: { sky: NIGHT, glow: '#5b4bd6', motif: 'moon', body: ['#fff6d8', '#cbbd94'] },
  silverMoon: { sky: ['#0a1428', '#16284d', '#28365e'], glow: '#7aa2e3', motif: 'moon', body: ['#f2f5ff', '#a9b4d6'], hills: '#070d1d' },
  newMoon: { sky: ['#05060f', '#12133a', '#2b1d52'], glow: '#8b6cff', motif: 'eclipse', body: ['#ffe9b8', '#ffd27a'] },
  mercury: { sky: ['#ff7a59', '#a83279', '#3a1c71'], glow: '#ffb36b', motif: 'planet', body: ['#ffd8a8', '#c97b4a'] },
  venus: { sky: ['#1fa2a0', '#3f5efb', '#fc466b'], glow: '#ff9ad5', motif: 'planet', body: ['#ffe3f1', '#e58bb4'] },
  saturn: { sky: ['#0d1033', '#2b2370', '#51308a'], glow: '#f2c46d', motif: 'ringed', body: ['#f7dfa8', '#b88a45'] },
  jupiter: { sky: ['#132042', '#2b3f7a', '#5c3a6e'], glow: '#ffb27a', motif: 'ringed', body: ['#f8d6b0', '#b5703e'] },
  sun: { sky: ['#ff9a3c', '#ff5e62', '#6a1b5a'], glow: '#ffe08a', motif: 'sun', body: ['#fff4b8', '#ffb347'], hills: '#3b0f2e' },
  sunrise: { sky: ['#1d2b64', '#f8a07a', '#ffd89b'], glow: '#ffffff', motif: 'sun', body: ['#fffbe0', '#ffc46b'], hills: '#2a1f4a' },
  fire: { sky: ['#2b0a1f', '#8e1b2c', '#f2683a'], glow: '#ff8a4c', motif: 'constellation', body: ['#ffe2c2', '#ff9a5a'] },
  earth: { sky: ['#0f2a1d', '#2c5b3f', '#8a7a3c'], glow: '#c9e6a8', motif: 'moon', body: ['#f4ecd0', '#b9ab7b'], hills: '#0a1a12' },
  water: { sky: ['#041b2d', '#0b4f6c', '#2a8fbd'], glow: '#7fd6ff', motif: 'constellation', body: ['#e2f6ff', '#8fd3ff'], hills: '#03121f' },
  violet: { sky: ['#160b33', '#3d1a78', '#7b2ff7'], glow: '#c08bff', motif: 'constellation', body: ['#f3e8ff', '#c9a7ff'] },
  scorpio: { sky: ['#12020a', '#4a0d22', '#8c1c3a'], glow: '#ff4f7a', motif: 'constellation', body: ['#ffd6e0', '#ff7a9a'] },
} satisfies Record<string, BannerStyle>;

// ---------- Posts ----------
export interface SeedPost {
  title: string;
  category: string;
  author: AccountKey;
  /** Days before now (negative = scheduled in the future). */
  daysAgo: number;
  status?: 'draft' | 'published';
  /** The author turned comments off (the ones already written stay hidden). */
  commentsOff?: boolean;
  excerpt: string;
  banner?: BannerStyle;
  html: string;
}

export const POSTS: SeedPost[] = [
  {
    title: 'Luna plină în Berbec: ce aduce pentru fiecare zodie',
    category: 'faze',
    author: 'andreea',
    daysAgo: 0.08,
    banner: { ...banners.moon, glyph: '♈' },
    excerpt: 'Luna plină din Berbec aprinde dorința de independență. Iată cum o simte fiecare semn și ce merită să lași în urmă.',
    html: [
      h2('Energia Lunii pline'),
      p(`Luna plină în Berbec luminează axa Berbec–Balanță: echilibrul dintre <strong>ce vrei tu</strong> și <strong>ce au nevoie ceilalți</strong>. Este un moment de claritate, în care emoțiile ies repede la suprafață și cer ${mark('acțiune')}.`),
      quote('„Luna plină nu creează conflicte — doar aprinde lumina în camerele pe care le-am evitat.”'),
      h3('Pe scurt, pentru fiecare element'),
      ul(
        '<strong>Foc</strong> (Berbec, Leu, Săgetător): energie maximă — canalizeaz-o într-un proiect, nu într-o ceartă.',
        '<strong>Pământ</strong> (Taur, Fecioară, Capricorn): o decizie amânată cere, în sfârșit, un răspuns.',
        '<strong>Aer</strong> (Gemeni, Balanță, Vărsător): conversațiile sincere repară mai mult decât crezi.',
        '<strong>Apă</strong> (Rac, Scorpion, Pești): odihnește-te — sensibilitatea e mai mare ca de obicei.',
      ),
      h3('Ritual de 10 minute'),
      tasks(
        ['Scrie pe o foaie un lucru pe care vrei să-l lași în urmă', true],
        ['Rupe foaia și arunc-o, simbolic', false],
        ['Notează o intenție nouă pentru următoarele două săptămâni', false],
      ),
      hr,
      table(['Zodie', 'Energie', 'Sfat'], ['Berbec', 'Foarte ridicată', 'Începe ce ai amânat'], ['Balanță', 'Agitată', 'Alege-te pe tine, măcar o dată'], ['Rac', 'Sensibilă', 'Spune ce simți, nu ce crezi că trebuie']),
      center('Ne vedem la Luna nouă! ✨'),
    ].join(''),
  },
  {
    title: 'Horoscopul zilei: 14 octombrie',
    category: 'zilnic',
    author: 'andreea',
    daysAgo: 0.3,
    excerpt: 'O zi bună pentru conversații importante și decizii practice. Luna trece prin Berbec și ne împinge spre acțiune.',
    html: [
      p('Luna în Berbec ne dă curaj, iar Venus în armonie cu Saturn ne ajută să construim ceva durabil. Iată ce aduce ziua pentru fiecare semn:'),
      ul(
        '<strong>♈ Berbec</strong> — ai energie cât pentru doi; termină ce ai început ieri.',
        '<strong>♉ Taur</strong> — o cheltuială neprevăzută se dovedește o investiție bună.',
        '<strong>♊ Gemeni</strong> — un mesaj vechi primește, în sfârșit, răspuns.',
        '<strong>♋ Rac</strong> — familia are nevoie de tine, dar și tu ai nevoie de odihnă.',
        '<strong>♌ Leu</strong> — ești în centrul atenției; folosește-l pentru o cauză bună.',
        '<strong>♍ Fecioară</strong> — ordinea din jur îți aduce liniște în minte.',
        '<strong>♎ Balanță</strong> — spune „nu” fără să te scuzi. Va fi eliberator.',
        '<strong>♏ Scorpion</strong> — intuiția ta are dreptate; verifică totuși detaliile.',
        '<strong>♐ Săgetător</strong> — planifică o mică aventură pentru weekend.',
        '<strong>♑ Capricorn</strong> — un superior observă efortul tău constant.',
        '<strong>♒ Vărsător</strong> — o idee neobișnuită merită testată.',
        '<strong>♓ Pești</strong> — creativitatea curge; notează tot ce-ți trece prin minte.',
      ),
    ].join(''),
  },
  {
    title: 'Mercur retrograd: ghid de supraviețuire în 5 pași',
    category: 'mercur',
    author: 'victor',
    daysAgo: 2,
    banner: banners.mercury,
    excerpt: 'De trei ori pe an, Mercur pare să meargă înapoi. Nu e un dezastru — e o invitație să încetinești.',
    html: [
      p('Mercur guvernează comunicarea, tehnologia și călătoriile scurte. Când devine <em>retrograd</em>, privit de pe Pământ pare să se miște înapoi pe cer timp de aproximativ trei săptămâni.'),
      h2('Cei 5 pași'),
      ol(
        '<strong>Recitește înainte să trimiți.</strong> Mesajele ambigue sunt primele victime.',
        '<strong>Fă backup.</strong> Telefonul, laptopul, pozele — acum, nu mâine.',
        '<strong>Nu semna în grabă.</strong> Contractele merită o a doua lectură.',
        '<strong>Revizuiește, nu începe.</strong> E perioada ideală pentru proiectele lăsate la jumătate.',
        '<strong>Ai răbdare cu ceilalți.</strong> Toată lumea trece prin aceleași mici încurcături.',
      ),
      quote('„Retrogradul nu îți strică planurile, ci îți arată unde sunt fisurile.”'),
      h3('Ce zodii îl simt cel mai tare?'),
      p(`Gemenii și Fecioarele, guvernate de Mercur, simt cel mai puternic aceste perioade. Dacă ai Mercur retrograd în harta natală, s-ar putea chiar să te simți ${mark('mai în largul tău', '#d6f5e3')} decât ceilalți.`),
    ].join(''),
  },
  {
    title: 'Taur și Fecioară: o iubire construită pe răbdare',
    category: 'compatibilitate',
    author: 'andreea',
    daysAgo: 4,
    banner: { ...banners.earth, glyph: '♉' },
    excerpt: 'Două semne de Pământ, un ritm comun și multă grijă pentru detalii. De ce funcționează atât de bine — și unde pot apărea fricțiuni.',
    html: [
      p('Când un Taur întâlnește o Fecioară, lucrurile nu se întâmplă peste noapte. Și tocmai asta e frumusețea: relația crește încet, solid, pe încredere.'),
      h2('De ce se potrivesc'),
      ul(
        '<strong>Valori comune:</strong> stabilitate, loialitate și plăcerea lucrurilor simple.',
        '<strong>Comunicare:</strong> Fecioara analizează, Taurul ascultă — un echilibru rar.',
        '<strong>Ritm:</strong> niciunul nu se grăbește, iar încrederea crește natural.',
      ),
      h2('Unde apar fricțiunile'),
      p('Taurul poate fi încăpățânat, iar Fecioara uneori prea critică. Secretul este ca observațiile să vină cu blândețe, iar schimbările — cu timp.'),
      table(['Aspect', 'Scor'], ['Dragoste', '9/10'], ['Comunicare', '8/10'], ['Prietenie', '9/10'], ['Bani', '10/10']),
      quote('„Cea mai romantică declarație pentru un Taur? Un plan bine făcut, semnat de o Fecioară.”'),
    ].join(''),
  },
  {
    title: 'Ce este ascendentul și de ce contează atât de mult',
    category: 'ghiduri',
    author: 'victor',
    daysAgo: 6,
    banner: banners.sunrise,
    excerpt: 'Zodia ta solară spune cine ești, dar ascendentul arată cum te văd ceilalți. Află cum îl calculezi și ce dezvăluie.',
    html: [
      p('Mulți oameni își cunosc zodia, dar puțini își știu <strong>ascendentul</strong>. Și totuși, el explică de ce nu te regăsești mereu în descrierea zodiei tale.'),
      h2('Ce este ascendentul'),
      p('Ascendentul este semnul zodiacal care răsărea la orizontul estic în momentul nașterii tale. Pentru că cerul „se rotește” complet într-o zi, ascendentul se schimbă cam la fiecare două ore.'),
      h2('De ce ai nevoie ca să-l afli'),
      ul('Data nașterii', `Ora exactă — ${mark('cât mai precisă')}, ideal din certificatul de naștere`, 'Locul nașterii'),
      h3('Ce influențează'),
      ul('Prima impresie pe care o lași', 'Stilul vestimentar și felul de a te mișca', 'Modul în care reacționezi la situații noi'),
      quote('„Soarele este cine ești, Luna este ce simți, iar ascendentul este ușa prin care intri în lume.”'),
    ].join(''),
  },
  {
    title: 'Berbecul: curajul de a începe primul',
    category: 'berbec',
    author: 'andreea',
    daysAgo: 9,
    banner: { ...banners.fire, glyph: '♈' },
    excerpt: 'Primul semn al zodiacului trăiește pentru începuturi. Punctele forte, provocările și cel mai bun sfat pentru un Berbec.',
    html: [
      p('Berbecul deschide zodiacul și, la fel ca primăvara, aduce energie, impuls și dorința de a face lucrurile <em>acum</em>.'),
      h2('Puncte forte'),
      ul('Curaj în fața necunoscutului', 'Sinceritate directă, fără jocuri', 'Energie contagioasă — îi molipsește pe toți'),
      h2('Provocări'),
      ul('Impulsivitate', 'Răbdare scurtă', 'Tendința de a abandona proiectele după entuziasmul de început'),
      h3('Sfatul lunii'),
      p(`Alege ${mark('un singur proiect')} și du-l până la capăt înainte să începi altul. Victoria de la final valorează mai mult decât zece începuturi.`),
    ].join(''),
  },
  {
    title: 'Leul în dragoste: generozitate, loialitate și puțină dramă',
    category: 'leu',
    author: 'andreea',
    daysAgo: 12,
    banner: { ...banners.sun, glyph: '♌' },
    excerpt: 'Leul iubește cu toată inima și se așteaptă la același lucru. Ce își dorește de la un partener și cum îi câștigi încrederea.',
    html: [
      p('Guvernat de Soare, Leul are nevoie să strălucească — iar în dragoste, vrea un partener care să-l vadă cu adevărat.'),
      h2('Ce caută Leul'),
      ul('Admirație sinceră, nu lingușire', 'Loialitate fără compromis', 'Un partener cu propria lumină'),
      h2('Cele mai bune potriviri'),
      table(
        ['Zodie', 'Compatibilitate', 'De ce'],
        ['Berbec', 'Foarte mare', 'Pasiune și aventură comună'],
        ['Săgetător', 'Foarte mare', 'Optimism și libertate'],
        ['Balanță', 'Mare', 'Eleganță și romantism'],
        ['Scorpion', 'Provocatoare', 'Două orgolii puternice'],
      ),
      quote('„Iubește un Leu și vei avea cel mai cald loc din univers.”'),
    ].join(''),
  },
  {
    title: 'Saturn în casa a 10-a: cariera ca lecție de viață',
    category: 'saturn',
    author: 'victor',
    daysAgo: 15,
    banner: banners.saturn,
    excerpt: 'Saturn în casa carierei aduce responsabilitate, recunoaștere târzie și o reputație construită cărămidă cu cărămidă.',
    html: [
      p('Casa a 10-a vorbește despre carieră, statut și felul în care lumea îți vede realizările. Când Saturn se află aici, drumul e mai lung — dar și mai solid.'),
      h2('Lecțiile principale'),
      ol('<strong>Răbdarea</strong> — succesul vine, dar în ritmul lui.', '<strong>Autoritatea</strong> se câștigă, nu se primește.', '<strong>Echilibrul</strong> dintre muncă și viața personală.'),
      quote('„Saturn nu refuză — doar spune „încă nu”.”'),
      p('Mulți oameni cu această poziție își ating apogeul profesional după 35–40 de ani, cu o stabilitate pe care alții o invidiază.'),
    ].join(''),
  },
  {
    title: 'Venus în Scorpion: când iubirea devine transformare',
    category: 'venus',
    author: 'victor',
    daysAgo: 18,
    banner: banners.venus,
    excerpt: 'Venus în Scorpion iubește intens, loial și fără jumătăți de măsură. Cum se manifestă în relații și ce lecții aduce.',
    html: [
      p('Venus este planeta iubirii și a frumuseții, iar Scorpionul este semnul profunzimii. Împreună, creează o iubire care nu se mulțumește cu suprafața.'),
      h2('În relații'),
      ul('Loialitate totală', 'Nevoie de intimitate emoțională reală', 'Atracție pentru mistere și conversații profunde'),
      h2('Umbra'),
      p('Gelozia și nevoia de control pot apărea atunci când încrederea e rănită. Exercițiul de mai jos ajută:'),
      tasks(['Recunosc când gelozia vorbește în locul meu', false], ['Îmi spun nevoile direct, fără teste', false], ['Las trecutul să rămână în trecut', false]),
    ].join(''),
  },
  {
    title: 'Cum îți citești harta natală: primii 4 pași',
    category: 'ghiduri',
    author: 'andreea',
    daysAgo: 21,
    excerpt: 'Harta natală pare complicată la început, dar are o logică simplă. Patru pași ca să înțelegi ce vezi.',
    html: [
      p('O hartă natală este o fotografie a cerului din momentul nașterii tale. Iată cum o citești, fără să te pierzi în detalii.'),
      h2('1. Soarele, Luna și Ascendentul'),
      p('Sunt „cei trei mari”: identitatea, emoțiile și felul în care te prezinți lumii. Începe mereu cu ei.'),
      h2('2. Elementele dominante'),
      p('Numără câte planete ai în semne de Foc, Pământ, Aer și Apă. Elementul dominant spune multe despre temperament.'),
      h2('3. Casele astrologice'),
      table(['Casa', 'Domeniu'], ['1', 'Identitate și aspect'], ['2', 'Bani și valori'], ['4', 'Casă și familie'], ['7', 'Parteneriate'], ['10', 'Carieră și reputație']),
      h2('4. Aspectele'),
      p('Unghiurile dintre planete arată cum colaborează energiile tale: armonios (trigon, sextil) sau tensionat (careu, opoziție).'),
    ].join(''),
  },
  {
    title: 'Luna nouă în Balanță: intenții pentru echilibru',
    category: 'faze',
    author: 'andreea',
    daysAgo: 25,
    banner: banners.newMoon,
    excerpt: 'Luna nouă în Balanță este momentul perfect pentru intenții legate de relații, armonie și frumusețe.',
    html: [
      p('La Luna nouă, cerul este întunecat, iar noi avem spațiu să plantăm intenții. În Balanță, ele se îndreaptă spre relații și echilibru.'),
      h2('Intenții potrivite'),
      ul('Să ascult mai mult decât vorbesc', 'Să cer ajutor atunci când am nevoie', 'Să fac loc frumosului în casa mea'),
      h3('Ritual simplu'),
      tasks(['Aprinde o lumânare', true], ['Scrie trei intenții la timpul prezent', false], ['Citește-le cu voce tare și păstrează foaia', false]),
      p('Recitește intențiile la următoarea Lună plină și observă ce s-a schimbat.'),
    ].join(''),
  },
  {
    title: 'Peștii: intuiția ca superputere',
    category: 'pesti',
    author: 'andreea',
    daysAgo: 29,
    banner: { ...banners.water, glyph: '♓' },
    excerpt: 'Ultimul semn al zodiacului simte ce alții abia observă. Cum își poate folosi Peștii sensibilitatea fără să se piardă în ea.',
    html: [
      p('Peștii închid zodiacul și poartă în ei ceva din toate celelalte semne. De aici vin empatia uriașă și intuiția aproape magică.'),
      h2('Darurile Peștilor'),
      ul('Empatie profundă', 'Imaginație și creativitate fără limite', 'Intuiție care rareori greșește'),
      h2('Cum se protejează'),
      ul('Timp singur, în liniște, în fiecare zi', 'Limite clare în relații', 'Artă, muzică sau apă — orice îi ajută să se descarce'),
      quote('„Peștii nu înoată împotriva curentului. Ei simt încotro merge oceanul.”'),
    ].join(''),
  },
  {
    title: 'Jupiter în Rac: abundența începe acasă',
    category: 'jupiter',
    author: 'victor',
    daysAgo: 33,
    banner: banners.jupiter,
    excerpt: 'Jupiter, planeta norocului, se simte exaltat în Rac. Ce înseamnă pentru familie, casă și siguranța emoțională.',
    html: [
      p('Jupiter amplifică tot ce atinge. În Rac, semnul casei și al familiei, el aduce creștere acolo unde ne simțim în siguranță.'),
      h2('Unde se simte norocul'),
      ul('Mutări sau renovări reușite', 'Împăcări în familie', 'Proiecte de suflet care, în sfârșit, prind viață'),
      p(`Cel mai bun mod de a folosi acest tranzit: ${mark('investește în locul în care te simți acasă', '#d6e9ff')} — fie el o casă, o comunitate sau o relație.`),
    ].join(''),
  },
  {
    title: 'Elementul Aer: Gemeni, Balanță și Vărsător pe înțelesul tuturor',
    category: 'aer',
    author: 'andreea',
    daysAgo: 37,
    excerpt: 'Trei feluri de a gândi, de a comunica și de a vedea lumea. Ce au în comun semnele de Aer și ce le deosebește.',
    html: [
      p('Semnele de Aer trăiesc prin idei. Au nevoie de conversație, de libertate și de oameni care să le stimuleze mintea.'),
      table(['Zodie', 'Modalitate', 'Cuvânt-cheie'], ['Gemeni', 'Mutabil', 'Curiozitate'], ['Balanță', 'Cardinal', 'Armonie'], ['Vărsător', 'Fix', 'Inovație']),
      h2('Ce au în comun'),
      p('Obiectivitate, sociabilitate și o nevoie constantă de schimb de idei.'),
      h2('Cum se deosebesc'),
      ul('<strong>Gemenii</strong> adună informații din toate direcțiile.', '<strong>Balanța</strong> caută echilibrul dintre perspective.', '<strong>Vărsătorul</strong> le răstoarnă pe toate ca să vadă ce urmează.'),
    ].join(''),
  },
  {
    title: 'Scorpionul: arta transformării',
    category: 'scorpion',
    author: 'andreea',
    daysAgo: 41,
    commentsOff: true,
    banner: { ...banners.scorpio, glyph: '♏' },
    excerpt: 'Intens, misterios și incredibil de loial: Scorpionul știe să renască din propria cenușă.',
    html: [
      p('Scorpionul este semnul transformării. Nu se teme de profunzimi — dimpotrivă, acolo se simte acasă.'),
      h2('Ce îl face special'),
      ul('Loialitate absolută față de cei apropiați', 'Capacitatea de a vedea dincolo de aparențe', 'Reziliență: fiecare criză îl face mai puternic'),
      quote('„Scorpionul nu uită, dar învață. Și fiecare lecție devine armură.”'),
      p('Sfatul pentru Scorpioni: lasă oamenii să te cunoască treptat. Vulnerabilitatea nu e slăbiciune, ci încredere.'),
    ].join(''),
  },
  {
    title: 'Ritualuri simple pentru Luna plină',
    category: 'faze',
    author: 'victor',
    daysAgo: 46,
    banner: banners.silverMoon,
    excerpt: 'Nu ai nevoie de cristale scumpe sau ceremonii lungi. Trei ritualuri de 10 minute pentru orice Lună plină.',
    html: [
      p('Luna plină este momentul culminării: ce am început la Luna nouă dă roade, iar ce nu ne mai servește poate fi eliberat.'),
      h2('1. Lista de eliberare'),
      p('Scrie tot ce vrei să lași în urmă: obiceiuri, temeri, resentimente. Apoi rupe foaia.'),
      h2('2. Apa lunară'),
      p('Lasă un pahar cu apă la fereastră peste noapte. Dimineața, bea-l cu o intenție clară.'),
      h2('3. Recunoștința'),
      p('Notează trei lucruri pentru care ești recunoscător în ultimele două săptămâni.'),
      tasks(['Lista de eliberare', true], ['Apa lunară', true], ['Jurnalul de recunoștință', false]),
    ].join(''),
  },
  {
    title: 'Capricornul: ambiția care construiește în timp',
    category: 'capricorn',
    author: 'andreea',
    daysAgo: 51,
    banner: { ...banners.earth, glyph: '♑' },
    excerpt: 'Capricornul urcă muntele pas cu pas. De ce răbdarea lui este, de fapt, cea mai mare putere.',
    html: [
      p('Guvernat de Saturn, Capricornul înțelege ceva ce alții învață târziu: lucrurile valoroase cer timp.'),
      h2('Puncte forte'),
      ul('Disciplină și consecvență', 'Simțul responsabilității', 'Umor sec, surprinzător de fin'),
      h2('Provocări'),
      p('Tendința de a munci prea mult și de a-și ascunde emoțiile. Odihna nu este un premiu, ci o necesitate.'),
    ].join(''),
  },
  {
    title: 'Gemenii: două voci, o singură curiozitate',
    category: 'gemeni',
    author: 'andreea',
    daysAgo: 55,
    excerpt: 'Gemenii vor să știe tot, să vorbească cu toată lumea și să încerce orice. Cum își găsesc focusul.',
    html: [
      p('Gemenii sunt mesagerii zodiacului: rapizi, spirituali și mereu cu o întrebare nouă.'),
      h2('Ce îi motivează'),
      ul('Informația nouă', 'Conversațiile spontane', 'Varietatea — rutina îi sufocă'),
      h3('Un exercițiu de focus'),
      tasks(['Alege trei priorități pentru săptămână', false], ['Notează ideile noi într-un singur loc', false], ['Termină una înainte să începi alta', false]),
    ].join(''),
  },
  {
    title: 'Soarele în harta natală: identitatea ta de bază',
    category: 'soare',
    author: 'victor',
    daysAgo: 60,
    banner: banners.sun,
    excerpt: 'Soarele este centrul hărții natale: vitalitatea, eul și direcția vieții. Cum îl interpretezi corect.',
    html: [
      p('Când spui „sunt Leu” sau „sunt Pești”, vorbești despre poziția Soarelui în momentul nașterii. Dar Soarele înseamnă mai mult decât zodia.'),
      h2('Ce reprezintă'),
      ul('Identitatea și voința', 'Vitalitatea fizică', 'Ce ne face să ne simțim vii'),
      h2('Soarele în case'),
      p('Casa în care se află Soarele arată domeniul vieții în care vrei să strălucești: casa a 5-a — creativitate, casa a 10-a — carieră, casa a 7-a — relații.'),
    ].join(''),
  },
  {
    title: 'Horoscopul săptămânii 13–19 octombrie',
    category: 'saptamanal',
    author: 'andreea',
    daysAgo: 1.4,
    banner: banners.violet,
    excerpt: 'O săptămână a echilibrului: Soarele în Balanță ne cere să ne punem în ordine relațiile, iar Marte ne dă curaj.',
    html: [
      p('Săptămâna aceasta, Soarele tranzitează Balanța, iar Luna plină din Berbec ne testează răbdarea. Iată ce ne așteaptă:'),
      table(
        ['Zodie', 'Dragoste', 'Carieră', 'Sănătate'],
        ['Berbec', '★★★★', '★★★', '★★★★'],
        ['Taur', '★★★', '★★★★', '★★★'],
        ['Gemeni', '★★★★★', '★★★', '★★★'],
        ['Rac', '★★', '★★★★', '★★★★'],
      ),
      p(`Ziua cea mai bună a săptămânii: ${mark('joi')}, când Venus face un trigon cu Jupiter.`),
    ].join(''),
  },
  {
    title: 'Horoscopul lunii noiembrie 2026',
    category: 'lunar',
    author: 'andreea',
    daysAgo: -9,
    banner: banners.violet,
    excerpt: 'Ce aduce luna noiembrie pentru fiecare zodie: tranzite importante, zile norocoase și sfaturi.',
    html: [p('Noiembrie începe cu Soarele în Scorpion, o perioadă de introspecție și transformare.'), h2('Datele importante'), ul('5 noiembrie — Luna plină în Taur', '20 noiembrie — Luna nouă în Scorpion', '22 noiembrie — Soarele intră în Săgetător')].join(''),
  },
  {
    title: 'Eclipsa de Soare din martie 2027 (ciornă)',
    category: 'tranzite',
    author: 'victor',
    daysAgo: 0,
    status: 'draft',
    excerpt: '',
    html: [p('Notițe pentru articol: axa Pești–Fecioară, ce zodii sunt afectate, sfaturi practice.'), tasks(['Verifică datele exacte', true], ['Scrie secțiunea pe zodii', false], ['Alege imaginea banner', false])].join(''),
  },
];

// ---------- Comments ----------
export const MEMBER_COMMENTS = [
  'Superb articol! Chiar am simțit energia asta săptămâna trecută. ✨',
  'Mulțumesc pentru sfaturi, le notez pe toate!',
  'Sunt Berbec și mă regăsesc 100%. 😅',
  'Aștept cu nerăbdare următorul articol despre Venus.',
  'Foarte bine explicat, chiar și pentru o începătoare ca mine.',
  'Am încercat ritualul și m-am simțit mult mai liniștită.',
  'Poți scrie și despre ascendentul în Fecioară?',
  'Exact ce aveam nevoie să citesc azi. ❤️',
  'Interesant! Nu știam că Mercur influențează și călătoriile.',
  'Partenerul meu e Taur și... da, totul se confirmă. 😄',
  'Tabelul e genial, l-am trimis tuturor prietenilor.',
  'Mi-ar plăcea un articol despre casele astrologice, pe larg.',
];

export const OWNER_REPLIES = [
  'Mulțumesc mult! Mă bucur că ți-a fost util. 🌙',
  'Bună idee — pregătesc un articol despre asta luna viitoare!',
  'Mulțumim pentru încredere! ✨',
];

export const MEMBER_REPLIES = [
  'Exact! Și eu am observat același lucru.',
  'Mulțumesc pentru explicație, acum are sens.',
  'Interesant, nu mă gândisem din perspectiva asta.',
  'La mine a fost invers, dar înțeleg ce spui.',
  'Pot confirma, sunt tot Berbec. 😄',
];

/** What the original commenter says back to a reply. */
export const FOLLOW_UPS = ['Mulțumesc mult pentru răspuns! 🙏', 'Super, abia aștept!', 'Am notat, încerc săptămâna asta.', 'Perfect, exact asta căutam.'];

/** For the long discussion under the Mercury retrograde post. */
export const MERCURY_COMMENTS = [
  'De fiecare dată când Mercur e retrograd mi se strică laptopul. Coincidență? 😅',
  'Am semnat un contract chiar în prima zi de retrogradare… acum înțeleg de ce au apărut atâtea probleme.',
  'Pasul 3 m-a ajutat mult: am recitit toate mesajele importante înainte să le trimit.',
  'Mi-a scris un fost după doi ani. Clasic Mercur retrograd!',
  'Eu folosesc perioada asta ca să termin lucrurile începute, nu să încep altele noi.',
  'Se simte diferit dacă ai Mercur în semn de foc? Eu sunt cu el în Berbec.',
  'Am făcut back-up la telefon datorită articolului. Mulțumesc!',
  'Cât durează efectul de umbră după ce Mercur își reia mersul direct?',
  'Retrogradarea asta pică exact peste o călătorie. Vreun sfat?',
  'Pentru mine e o perioadă bună de reflecție, nu doar de haos.',
  'Am observat că oamenii din jurul meu devin mai nervoși în perioadele astea.',
  'Super util ghidul, l-am trimis și surorii mele.',
];

/** Weighted pool of comment reactions (must be among the server's COMMENT_EMOJI). */
export const REACTIONS = ['❤️', '❤️', '❤️', '✨', '✨', '🌙', '🔥', '😂', '🙏'];
