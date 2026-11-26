import type { AccountKey } from '@/seed/content';

// ---------- Books (read chapter by chapter; each chapter is a post) ----------

const p = (text: string) => `<p>${text}</p>`;
const h2 = (text: string) => `<h2>${text}</h2>`;
const quote = (text: string) => `<blockquote><p>${text}</p></blockquote>`;

export interface SeedBook {
  key: string;
  title: string;
  /** Its subject: a category key from content.ts. */
  subject: string;
  author: AccountKey;
  description: string;
  cover: { template: string; layout: string; ornament: string; palette: string };
  /** Chapters the author plans (null: not said). */
  planned: number | null;
  complete: boolean;
  /** Days between chapters, and how long ago the newest public one came out. */
  every: number;
  lastDaysAgo: number;
  /** Chapters' titles; the first `published` are public, the next `scheduled` come later. */
  chapters: string[];
  published: number;
  scheduled: number;
  /** The first chapter, written out; the others are made from `paragraphs` and `quotes`. */
  opening: string;
  paragraphs: string[];
  quotes: string[];
}

export const BOOKS: SeedBook[] = [
  {
    key: 'drumul',
    title: 'Drumul meu printre stele',
    subject: 'despre-autor',
    author: 'victor',
    description: 'Cum am ajuns de la un copil care număra stelele de pe prispă la un om care scrie despre ele: o poveste spusă capitol cu capitol, în fiecare duminică.',
    cover: { template: 'spirala', layout: 'clasic', ornament: 'spiral', palette: 'adanc' },
    planned: 14,
    complete: false,
    every: 7,
    lastDaysAgo: 3,
    chapters: [
      'Prispa bunicilor',
      'Prima hartă pe care am citit-o',
      'Anii în care am uitat de cer',
      'Un telescop de la talcioc',
      'Orașul fără stele',
      'Scrisoarea care a schimbat totul',
      'Primul meu cititor',
      'Prima hartă natală pe care am citit-o',
      'Anul în care am învățat să aștept',
      'Ce nu se vede din oraș',
      'Oamenii care m-au învățat',
      'Greșelile frumoase',
      'Cerul de acasă',
      'Ce rămâne după',
    ],
    published: 9,
    scheduled: 1,
    opening:
      p('Vara în care am împlinit șapte ani am dormit pe prispa bunicilor, sub o pătură aspră, cu fața spre cer. Bunicul spunea că stelele sunt găuri prin care se vede lumina de dincolo. Eu credeam că sunt sate îndepărtate, cu oameni care stau și ei pe prispă și se uită la noi.') +
      p('Nu știam încă niciun nume de constelație. Știam doar că, dacă te uiți destul de mult, cerul se apropie. Și că liniștea de acolo, de pe prispă, nu semăna cu nicio altă liniște.') +
      quote('Unele drumuri încep cu o hartă. Al meu a început cu o prispă și cu un cer pe care nu-l înțelegeam încă.') +
      p('Cartea aceasta e povestea drumului de atunci până azi: oamenii, locurile și greșelile care m-au adus aici. O scriu capitol cu capitol, așa cum s-a și întâmplat.'),
    paragraphs: [
      'Mi-am dat seama târziu că cele mai importante lucruri nu mi s-au întâmplat în zilele mari, ci în serile obișnuite, când nimeni nu se uita. Acolo s-au strâns, încet, toate întrebările pe care le port și azi.',
      'Am ținut atunci un caiet cu coperți verzi, în care notam tot ce vedeam: ora, locul, culoarea Lunii. Multe însemnări nu mai au niciun sens pentru mine. Altele mă emoționează și acum, pentru că îmi arată cine eram.',
      'Nu toți cei din jur au înțeles. Unii zâmbeau politicos, alții mă întrebau, sincer, la ce folosește. Nu aveam un răspuns bun. Aveam doar sentimentul că, privind în sus, văd mai limpede ce e jos.',
      'Dacă aș putea să-i spun ceva copilului de atunci, i-aș spune să nu se grăbească. Că drumul nu se parcurge alergând, ci oprindu-te des, ca să vezi unde ești.',
      'În anii aceia am învățat că răbdarea nu e o virtute pasivă. E o formă de atenție: să stai cu ceva destul de mult încât să-ți arate ce are de arătat.',
    ],
    quotes: [
      'Cerul nu ne spune ce să facem. Ne amintește doar cât de mare e lumea în care facem ce facem.',
      'Am învățat să aștept abia când am înțeles că așteptarea e și ea o formă de drum.',
      'Nu am găsit răspunsuri în stele. Am găsit întrebări mai bune.',
    ],
  },
  {
    key: 'linistea',
    title: 'Liniștea dinăuntru',
    subject: 'spiritualitate',
    author: 'victor',
    description: 'Opt capitole despre cum facem loc liniștii într-o viață grăbită: respirația, tăcerea, serile, iertarea. Fără rețete, doar câteva uși deschise.',
    cover: { template: 'lotus', layout: 'clasic', ornament: 'lotus', palette: 'pergament' },
    planned: 8,
    complete: true,
    every: 9,
    lastDaysAgo: 20,
    chapters: [
      'Unde se ascunde liniștea',
      'Respirația, prima ușă',
      'Tăcerea care nu e goală',
      'Serile fără ecran',
      'Locul tău de acasă',
      'Iertarea ca odihnă',
      'Liniștea printre oameni',
      'Ce păstrezi pentru tine',
    ],
    published: 8,
    scheduled: 0,
    opening:
      p('Credem adesea că liniștea e un loc în care ajungem: o mănăstire, o pădure, un concediu. Și ne mirăm că, odată ajunși acolo, zgomotul vine cu noi, în bagaj.') +
      quote('Liniștea nu vine din lipsa zgomotului, ci din locul în care nu mai ajunge.') +
      p('Cartea aceasta pornește de la o idee simplă: liniștea nu e un loc, ci un fel de a fi atent. Se poate exersa, puțin câte puțin, chiar și în mijlocul unei zile încărcate.') +
      p('Fiecare capitol e o ușă. Nu trebuie să le deschizi pe toate. Uneori ajunge una.'),
    paragraphs: [
      'Încearcă diseară un lucru mic: înainte de culcare, stai un minut fără să faci nimic. Nu medita, nu număra, nu te ruga. Doar stai. O să observi cât de greu e, și cât de bine face.',
      'Nu tot ce ne obosește vine din afară. O parte vine din grija de a fi mereu pregătiți, mereu prezenți, mereu disponibili. Liniștea începe uneori cu un „nu” spus blând.',
      'Respirația e singurul lucru pe care îl porți mereu cu tine și care te poate aduce, oricând, înapoi în prezent. Trei respirații lente, cu expirul mai lung decât inspirul, sunt deja o mică întoarcere acasă.',
      'Tăcerea pe care o căutăm nu e golul de după zgomot. E o prezență: a ta, a lucrurilor, a celor de lângă tine. Când o găsești, nu mai simți nevoia s-o umpli.',
      'Nu te judeca pentru zilele în care nu reușești. Liniștea nu se câștigă o dată pentru totdeauna; se regăsește, iar și iar.',
    ],
    quotes: [
      'Nu trebuie să fugi de lume ca să găsești liniștea. Ajunge să nu mai fugi de tine.',
      'O seară fără grabă e o mică sărbătoare pe care ți-o dai singur.',
      'Iertarea nu schimbă trecutul. Schimbă cât de greu îl duci.',
    ],
  },
  {
    key: 'casele',
    title: 'Cele douăsprezece case',
    subject: 'astrologie',
    author: 'victor',
    description: 'O călătorie prin cele douăsprezece case ale hărții natale, una pe capitol: ce spune fiecare despre viața noastră și cum o citim fără frică.',
    cover: { template: 'roata', layout: 'clasic', ornament: 'wheel', palette: 'noapte' },
    planned: 12,
    complete: false,
    every: 5,
    lastDaysAgo: 1,
    chapters: [
      'Casa 1: chipul pe care îl arătăm',
      'Casa a 2-a: ce prețuim',
      'Casa a 3-a: cuvintele de zi cu zi',
      'Casa a 4-a: rădăcinile',
      'Casa a 5-a: bucuria de a crea',
      'Casa a 6-a: ritualurile zilnice',
      'Casa a 7-a: oglinda celuilalt',
      'Casa a 8-a: ce împărțim',
      'Casa a 9-a: drumurile lungi',
      'Casa a 10-a: ce construim',
      'Casa a 11-a: prietenii și visurile',
      'Casa a 12-a: ce nu se vede',
    ],
    published: 7,
    scheduled: 1,
    opening:
      p('Harta natală seamănă cu un ceas desenat pe cer în clipa nașterii tale. Planetele sunt acele, semnele sunt cifrele, iar casele sunt cele douăsprezece încăperi ale vieții prin care se mișcă totul.') +
      p('Prima casă începe cu ascendentul: semnul care se ridica la orizont când ai venit pe lume. E ușa casei, felul în care intri într-o încăpere și în care lumea te vede înainte să te cunoască.') +
      quote('Ascendentul nu e cine ești. E felul în care începi să fii, de fiecare dată când intri într-o încăpere nouă.') +
      p('În capitolele următoare trecem prin fiecare casă, pe rând, cu exemple și întrebări pe care ți le poți pune singur, cu harta ta în față.'),
    paragraphs: [
      'Ca să afli ce semn se află pe vârful acestei case, ai nevoie de ora exactă a nașterii. Câteva minute pot muta totul cu o casă mai încolo, așa că merită căutat certificatul sau întrebat cineva din familie.',
      'O casă goală, fără planete, nu înseamnă o zonă a vieții fără importanță. Înseamnă doar că lucrurile de acolo curg mai liniștit, guvernate de planeta care stăpânește semnul de pe vârful casei.',
      'Când o planetă lentă trece printr-o casă, simțim de obicei o reorganizare lungă a acelei zone: nu un eveniment, ci un anotimp. E bine să-l privim cu răbdare, nu cu teamă.',
      'Întreabă-te, cu harta în față: unde îmi pun energia în zona aceasta a vieții? Unde mă grăbesc și unde mă ascund? Astrologia nu răspunde în locul tău, dar te ajută să pui întrebarea potrivită.',
      'Fiecare casă are o pereche, în partea opusă a roții. Casa 1 și casa a 7-a, eu și celălalt; casa a 4-a și casa a 10-a, rădăcini și vârf. Citite împreună, spun mai mult decât separat.',
    ],
    quotes: [
      'Harta nu e destinul tău. E doar lumina sub care îl privești.',
      'O casă grea nu e o pedeapsă, ci locul în care ai cel mai mult de învățat.',
      'Celălalt e oglinda în care vedem ce n-am fi văzut niciodată singuri.',
    ],
  },
  {
    key: 'ritmuri',
    title: 'Ritmuri lunare',
    subject: 'echilibru',
    author: 'victor',
    description: 'Șase capitole despre cum ne putem așeza zilele după fazele Lunii: când începem, când culegem, când lăsăm să plece.',
    cover: { template: 'faze', layout: 'clasic', ornament: 'moons', palette: 'ardezie' },
    planned: 6,
    complete: true,
    every: 7,
    lastDaysAgo: 35,
    chapters: [
      'Luna nouă: a semăna în tăcere',
      'Primul pătrar: primul pas',
      'Luna care crește',
      'Luna plină: ce se arată',
      'Ultimul pătrar: a lăsa să plece',
      'Un an întreg, lună de lună',
    ],
    published: 6,
    scheduled: 0,
    opening:
      p('Înainte de calendare și de ceasuri, oamenii își măsurau timpul după Lună. Semănatul, culesul, sărbătorile, chiar și tăierea părului aveau o fază potrivită.') +
      quote('Luna nu ne grăbește. Ne arată doar că totul are un ritm: și creșterea, și odihna.') +
      p('Nu trebuie să crezi în influența Lunii ca să folosești ritmul ei. E de ajuns să-l iei ca pe un calendar mai blând, care îți amintește, la fiecare două săptămâni, să începi sau să închei ceva.') +
      p('Luna nouă e începutul: cerul e întunecat, iar intențiile se pun în pământ fără să se vadă încă nimic.'),
    paragraphs: [
      'Scrie trei intenții pe o foaie, la Luna nouă, și pune-o deoparte. Nu le citi zilnic. Le recitești la Luna plină și o să vezi ce a crescut fără să-l forțezi.',
      'Faza aceasta e bună pentru lucruri practice: o listă, o programare amânată, o discuție pe care o tot ocolești. Energia e acolo; trebuie doar folosită.',
      'Dacă te simți obosit la Luna plină, nu e nimic în neregulă cu tine. Mulți oameni dorm mai prost în nopțile acelea. Fă-ți serile mai liniștite și mai devreme.',
      'Ultimul pătrar e momentul curățeniei: un sertar, un obicei, o relație care te consumă. Nu tot ce pleacă e o pierdere.',
      'Ține un mic jurnal lunar: o frază pe zi ajunge. După câteva luni, o să-ți vezi propriile ritmuri mai clar decât în orice horoscop.',
    ],
    quotes: [
      'Ce semeni în întuneric crește fără să ceară voie.',
      'A lăsa să plece e și el un fel de a culege.',
      'Ritmul tău e mai vechi decât graba din jur.',
    ],
  },
  {
    key: 'umbra',
    title: 'Umbra și lumina',
    subject: 'psihologie',
    author: 'victor',
    description: 'Despre părțile din noi pe care nu le arătăm nimănui, nici măcar nouă: de unde vin, ce păzesc și cum ne putem împrieteni cu ele.',
    cover: { template: 'semiluna', layout: 'clasic', ornament: 'halfmoon', palette: 'teracota' },
    planned: 10,
    complete: false,
    every: 6,
    lastDaysAgo: 5,
    chapters: [
      'Ce ascundem chiar și de noi',
      'Masca pe care o purtăm',
      'Furia care păzește ceva',
      'Rușinea, o veche cunoștință',
      'Masca pe care o purtăm acasă',
      'Când umbra vorbește în ceilalți',
      'Darurile din întuneric',
      'A te ierta pe tine',
      'Lumina care nu orbește',
      'Întregi, nu perfecți',
    ],
    published: 4,
    scheduled: 1,
    opening:
      p('Fiecare dintre noi are o parte pe care a învățat, devreme, s-o ascundă. Uneori e furia, alteori tristețea, alteori o dorință pe care cineva a numit-o, cândva, egoistă.') +
      p('Psihologul Carl Jung a numit-o umbra: tot ce nu se potrivește cu imaginea pe care o avem despre noi. Nu dispare când n-o privim. Doar lucrează pe ascuns.') +
      quote('Umbra nu e dușmanul tău. E partea din tine care a așteptat cel mai mult să fie văzută.') +
      p('Capitolele acestei cărți nu promit vindecări rapide. Propun doar câteva întâlniri, blânde, cu părțile din noi pe care le-am lăsat afară.'),
    paragraphs: [
      'Gândește-te la o trăsătură care te irită foarte tare la alții. De multe ori, intensitatea reacției spune ceva despre noi, nu doar despre ei. Nu e o acuzație; e o invitație la curiozitate.',
      'Emoțiile pe care le numim negative au, aproape toate, o funcție de protecție. Furia păzește o graniță. Tristețea onorează o pierdere. Frica ne ține în viață.',
      'Când observi că te porți altfel decât ai vrea, încearcă să te întrebi nu „ce e în neregulă cu mine?”, ci „de ce are nevoie partea asta din mine?”.',
      'Scrisul ajută. Scrie o scrisoare din partea emoției pe care o eviți cel mai des. Lasă-o să spună ce are de spus, fără să o corectezi.',
      'Nu e nevoie să faci totul singur. Un terapeut bun e un însoțitor pe drumul acesta, nu un judecător.',
    ],
    quotes: [
      'Ce nu privim nu dispare. Doar crește în locurile în care nu ne uităm.',
      'Furia ta are adesea dreptate. Doar că vorbește prea tare.',
      'A fi întreg nu înseamnă a fi fără umbră, ci a nu mai fugi de ea.',
    ],
  },
  {
    key: 'rugaciuni',
    title: 'Rugăciuni pentru zile grele',
    subject: 'credinta',
    author: 'victor',
    description: 'Cinci capitole scurte, pentru zilele în care nu găsești cuvintele: frica, doliul, oboseala, recunoștința și nădejdea.',
    cover: { template: 'lumanare', layout: 'clasic', ornament: 'candle', palette: 'ceata' },
    planned: 5,
    complete: true,
    every: 10,
    lastDaysAgo: 50,
    chapters: ['Când nu găsești cuvintele', 'Pentru frică', 'Pentru cei care au plecat', 'Pentru oboseală', 'Pentru recunoștință'],
    published: 5,
    scheduled: 0,
    opening:
      p('Sunt zile în care rugăciunea vine ușor, ca o respirație. Și sunt zile în care stai în fața icoanei și nu spui nimic, pentru că nu mai ai ce să spui.') +
      quote('Uneori, rugăciunea cea mai sinceră e o tăcere în care nu mai pretinzi că ești bine.') +
      p('Cartea aceasta e pentru zilele acelea. Fiecare capitol e scurt și se poate citi în câteva minute, cu glas tare sau în gând.'),
    paragraphs: [
      'Nu trebuie să fii pregătit ca să te rogi. Poți începe exact de unde ești: obosit, supărat, nesigur. Cuvintele pot fi stângace; contează inima.',
      'Aprinde o lumânare, dacă te ajută. Lumina ei mică amintește că nu e nevoie de mult ca să alungi un pic din întuneric.',
      'Când nu mai poți spune nimic altceva, repetă doar: „Doamne, ajută.” Oamenii s-au rugat așa de mii de ani, și a fost de ajuns.',
      'Recunoștința nu șterge greutățile. Le pune doar alături de lucrurile bune care există și ele, chiar și în zilele grele.',
    ],
    quotes: [
      'Nădejdea nu e certitudinea că totul va fi bine, ci încrederea că nu ești singur, orice ar fi.',
      'O lumânare nu luminează toată camera. Dar ajunge ca să nu mai fie întuneric.',
    ],
  },
];

/** A chapter's text: the book's opening for the first, otherwise its paragraphs and a quote, turned by the number. */
export function chapterHtml(book: SeedBook, index: number) {
  if (index === 0) return book.opening;
  const pick = (list: string[], at: number) => list[at % list.length]!;
  return (
    p(pick(book.paragraphs, index)) +
    p(pick(book.paragraphs, index + 2)) +
    quote(pick(book.quotes, index)) +
    h2('Pentru tine') +
    p(pick(book.paragraphs, index + 3)) +
    p(pick(book.paragraphs, index + 1))
  );
}

/** Saved cover designs (the writers' templates). */
export const COVER_TEMPLATES = [
  { name: 'Seria Lunii', design: { layout: 'arc', ornament: 'moons', palette: 'lavanda' } },
  { name: 'Cer de toamnă', design: { layout: 'banda', ornament: 'stars', palette: 'teracota' } },
];
