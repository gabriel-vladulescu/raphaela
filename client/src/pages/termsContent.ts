import { site } from '@/config';
import type { Lang } from '@/lib/i18n';

// The Terms and Conditions page's text (TermsPage.tsx), including what the site stores and for how long. It has to
// match what the code does: server/src/lib/accounts.ts (deletion, retention), lib/visitor.ts (cookies, fingerprint),
// lib/analytics.ts (statistics), lib/newsletter.ts, client/src/lib/consent.ts (the banner). Links: [text](/path).
// The site's name and company come from its identity (admin panel → Setări → Identitate).

export interface TermsSection {
  id: string;
  title: string;
  paragraphs?: string[];
  items?: string[];
  table?: { head: string[]; rows: string[][] };
}

export interface TermsText {
  updatedLabel: string;
  intro: string[];
  sections: TermsSection[];
}

/** When the text last changed (shown at the top). */
export const TERMS_UPDATED = '2026-11-26';

const ro: TermsText = {
  updatedLabel: 'Ultima actualizare',
  intro: [
    `Bine ai venit pe ${site.name}. Folosind site-ul ești de acord cu acești termeni. Mai jos explicăm, pe înțeles, și ce date păstrăm despre tine, de ce și pentru cât timp.`,
  ],
  sections: [
    {
      id: 'cine-suntem',
      title: '1. Cine suntem',
      paragraphs: [
        `Site-ul este administrat de ${site.company} („noi”). Pentru orice întrebare despre acești termeni sau despre datele tale ne poți scrie prin [formularul de suport](/suport)${site.contactEmail ? ` sau la ${site.contactEmail}` : ''}.`,
      ],
    },
    {
      id: 'continut',
      title: '2. Articolele',
      paragraphs: [
        `Articolele sunt scrise de autorii site-ului și aparțin lor și ${site.company}. Le poți citi, distribui prin link și cita pe scurt, cu trimitere la sursă; copierea integrală sau republicarea fără acordul nostru nu este permisă.`,
        'Conținutul are scop informativ și de inspirație. Articolele despre astrologie, psihologie, sănătate sau spiritualitate nu înlocuiesc sfatul unui medic, psiholog, consilier financiar sau alt specialist.',
      ],
    },
    {
      id: 'cont',
      title: '3. Contul tău',
      items: [
        'Îți poți face cont cu Google sau cu email și parolă. Trebuie să ai cel puțin 16 ani.',
        'Datele din cont trebuie să fie ale tale și reale. Un cont e al unei singure persoane.',
        'Îți confirmi adresa de email prin linkul pe care ți-l trimitem; așa îți poți recupera contul dacă îți uiți parola.',
        'Ești responsabil(ă) pentru ce se face din contul tău. Păstrează-ți parola pentru tine; dacă bănuiești că altcineva o știe, schimb-o din Profil (te deconectează de pe celelalte dispozitive).',
      ],
    },
    {
      id: 'comentarii',
      title: '4. Comentarii și reguli de comunitate',
      paragraphs: ['Ne dorim discuții calde și respectuoase. Nu sunt permise:'],
      items: [
        'spamul, reclamele și linkurile înșelătoare;',
        'hărțuirea, insultele, amenințările sau atacurile la persoană;',
        'discursul instigator la ură sau discriminarea;',
        'conținutul ilegal, obscen sau care încalcă drepturile altora (inclusiv datele personale ale altcuiva).',
      ],
    },
    {
      id: 'moderare',
      title: '5. Moderare și suspendare',
      paragraphs: [
        'Orice cititor conectat poate raporta un comentariu. Administratorii verifică rapoartele și pot șterge comentarii care încalcă regulile.',
        'Unele comentarii pot aștepta aprobarea unui administrator înainte să apară (de exemplu primul comentariu al unui cont, sau unul cu un link ori cu un cuvânt filtrat); până atunci le vezi doar tu. Comentariile cu conținut interzis pot fi refuzate direct.',
        'Pentru încălcări repetate sau grave putem suspenda un cont, pe o perioadă sau până la ridicarea suspendării. Primești un email cu motivul și durata; cât timp e suspendat, contul nu se poate conecta, iar la conectare vezi până când durează suspendarea și motivul. Dacă e o greșeală, scrie-ne prin [formularul de suport](/suport).',
      ],
    },
    {
      id: 'date',
      title: '6. Ce date păstrăm',
      paragraphs: ['Păstrăm doar ce e nevoie ca site-ul să funcționeze și, cu acordul tău, statistici despre citire. Nu vindem date și nu afișăm reclame.'],
      table: {
        head: ['Ce', 'Detalii', 'De ce'],
        rows: [
          [
            'Contul',
            'Email, nume, nume de utilizator, poza de profil (încărcată de tine sau de la Google), ocupația și citatul (autorii), parola — doar ca amprentă criptografică (hash), niciodată în clar —, dacă ai conectat Google (identificatorul contului Google), rolul, dacă adresa e confirmată, când ai fost de acord cu termenii, când ți-ai făcut contul și când te-ai conectat ultima dată, setările de notificări și de confidențialitate, adresele, numele și numele de utilizator avute înainte (cu data schimbării).',
            'Ca să ai un cont (contract).',
          ],
          [
            'Ce faci pe site',
            'Comentariile (și versiunile lor dinainte de editare), reacțiile, aprecierile (și cele retrase, ca istoric), articolele salvate, autorii pe care îi urmărești, rapoartele trimise, notificările (inclusiv când cineva te menționează). Pentru autori: versiunile anterioare ale articolelor (cel mult 50 pe articol), cine și când le-a salvat.',
            'Ca site-ul să funcționeze și pentru moderare (contract, interes legitim).',
          ],
          [
            'Conectarea',
            'O sesiune pe dispozitiv; în baza de date ținem doar o amprentă a ei, 30 de zile, cu browserul (de exemplu „Chrome · Windows”). Fiecare încercare de autentificare: când, adresa scrisă, cum (parolă, Google, link) și dacă a reușit, cu browserul. Nu păstrăm adresa IP.',
            'Ca să rămâi conectat(ă) (contract).',
          ],
          [
            'Notificări push',
            'Dacă le pornești: adresa de livrare dată de browser și cheile ei, ce notificări vrei.',
            'Ca să-ți trimitem notificările cerute (consimțământ).',
          ],
          [
            'Suport',
            'Emailul, numele (opțional), mesajul și fișierele atașate.',
            'Ca să-ți răspundem; dacă ne scrii autentificat, conversația (mesajele tale și răspunsurile noastre) rămâne și în contul tău (interes legitim).',
          ],
          [
            'Newsletter',
            'Doar dacă te abonezi: adresa de email, dacă vrei toate articolele noi sau doar capitolele noi ale unor cărți (și care), limba, când te-ai abonat și când ai confirmat, ce articole ți-am trimis. Fiecare email are un link de dezabonare.',
            'Ca să-ți trimitem articolele cerute (consimțământ).',
          ],
          [
            'Invitații',
            'Dacă un administrator te invită să scrii: adresa ta, mesajul lui, cine a trimis invitația și dacă ai acceptat-o.',
            'Ca să poți deveni autor (interes legitim).',
          ],
          [
            'Căutări',
            'Cuvintele căutate pe site și câte rezultate au avut, numărate pe zi, fără nimic despre cine a căutat.',
            'Ca să știm ce caută cititorii (interes legitim).',
          ],
          [
            'Emailuri trimise',
            'Pentru fiecare email (confirmarea adresei, parola nouă, newsletterul etc.): adresa, subiectul, când și dacă a plecat.',
            'Ca să știm că emailurile ajung (interes legitim).',
          ],
          [
            'Acțiunile administratorilor',
            'Ce au făcut administratorii asupra unui cont, comentariu sau articol (de exemplu o suspendare), cine și când.',
            'Ca moderarea să fie transparentă și verificabilă (interes legitim).',
          ],
          [
            'Statistici',
            'Doar cu acordul tău: un identificator aleator într-un cookie, o amprentă calculată din adresa IP, browser și limbă (cu o cheie secretă; adresa IP nu se păstrează), pagina, ziua, site-ul de pe care ai venit (doar domeniul), tipul dispozitivului, cât ai citit și cât de departe, acțiuni precum aprecieri, distribuiri și salvări.',
            'Ca să știm ce se citește și să facem articole mai bune (consimțământ).',
          ],
        ],
      },
    },
    {
      id: 'cookie-uri',
      title: '7. Cookie-uri și stocare în browser',
      paragraphs: [
        'Fără acordul tău folosim doar ce e strict necesar. Fără acord la statistici, o vizită pe un articol doar crește contorul lui de vizualizări, fără nimic legat de tine.',
      ],
      table: {
        head: ['Nume', 'Pentru ce', 'Cât timp'],
        rows: [
          ['sid', 'Te ține conectat(ă). Necesar.', '30 de zile'],
          ['consent', 'Alegerea ta din bannerul de cookie-uri. Necesar.', '6 luni'],
          ['oauth_*', 'Pe durata conectării cu Google. Necesar.', '10 minute'],
          ['vid', 'Statistici, doar cu acordul tău; altfel doar când apreciezi un articol fără cont, ca să-ți ținem minte aprecierea.', '13 luni'],
          ['Stocare locală', 'Tema, limba, articolele salvate și aprecierile fără cont, copia de siguranță a ciornelor din editor, dacă ai închis invitația de instalare.', 'Până le ștergi din browser'],
        ],
      },
    },
    {
      id: 'terti',
      title: '8. Servicii externe',
      items: [
        'Google: dacă te conectezi cu Google, primim de la Google numele, emailul și poza contului. Fonturile site-ului sunt găzduite pe site, nu la Google.',
        'Videoclipurile YouTube din articole folosesc modul „fără cookie-uri”; când pornești unul, YouTube poate stoca date în browserul tău.',
        'Autorii pot căuta imagini pentru banner în Wikimedia Commons și Openverse: căutarea pleacă din browserul lor direct către acestea. Imaginea aleasă (și una adusă de pe alt site după adresa ei) e descărcată de serverul nostru și păstrată pe site, așa că cititorii nu se conectează la acele site-uri.',
        'Notificările push ajung prin serviciile browserului tău (Google, Apple, Mozilla).',
        'Emailurile (confirmarea adresei, parola nouă, schimbarea adresei, ștergerea și restaurarea contului, invitațiile și newsletterul) pleacă prin furnizorul nostru de email. Newsletterul îl primești doar dacă te abonezi și confirmi; nu trimitem reclame.',
        'Site-ul e găzduit pe servere închiriate de noi; datele nu sunt vândute și nu sunt date altcuiva în afară de acești furnizori, doar cât e nevoie pentru serviciul lor, sau dacă legea ne obligă.',
      ],
    },
    {
      id: 'pastrare',
      title: '9. Cât timp păstrăm datele',
      items: [
        'Contul și ce faci pe site: cât timp ai cont.',
        'După ștergerea contului: cel puțin 3 luni (vezi mai jos); apoi un administrator îl șterge definitiv, așa cum ai ales.',
        'Tichetele de suport: cel mult 2 ani.',
        'Statisticile: cel mult 25 de luni.',
        'Istoricul emailurilor trimise: 90 de zile. Jurnalul acțiunilor administratorilor: 2 ani.',
        'Abonarea la newsletter: până te dezabonezi (adresa rămâne apoi marcată ca dezabonată, ca să nu-ți mai scriem; o ștergem la cerere). O abonare neconfirmată: 30 de zile. Ce articole ți-am trimis: un an.',
        'Căutările (numărate pe zi): cel mult 25 de luni. Invitațiile: un an.',
        'Sesiunile: 30 de zile; evidența lor (când te-ai conectat și când s-a încheiat conectarea, de ce): încă 90 de zile. Încercările de autentificare: 90 de zile. Linkurile din emailuri funcționează o singură dată, între o oră și 48 de ore; evidența lor (când au fost trimise, folosite sau oprite): 90 de zile.',
        'Notificările push trimise (ce și către câte dispozitive) și erorile tehnice ale serverului: 90 de zile.',
        'Adresele de email, numele și numele de utilizator pe care le-ai avut înainte: cât timp ai cont.',
        'După aceste perioade, datele sunt șterse de un administrator: site-ul nu șterge nimic singur, dar administratorii sunt anunțați când există ceva de șters.',
      ],
    },
    {
      id: 'stergere',
      title: '10. Ștergerea contului',
      paragraphs: [
        'Îți poți șterge contul oricând din Profil → „Șterge contul”, după o confirmare. Alegi ce se întâmplă cu comentariile tale (rămân fără numele tău, sau se șterg împreună cu răspunsurile la ele) și, dacă ești autor, cu articolele tale (rămân pe site, sau se șterg). Ce se întâmplă:',
      ],
      items: [
        'Ești deconectat(ă) de pe toate dispozitivele și nu te mai poți conecta. La încercarea de conectare vezi data de la care contul poate fi șters definitiv. Nu mai primești nici newsletterul.',
        'Numele și poza ta dispar de pe site. Comentariile pe care alegi să le păstrezi apar ca „Cont șters”, ca discuțiile din jurul lor să aibă sens în continuare; cele pe care alegi să le ștergi (și articolele, dacă așa alegi) dispar imediat.',
        'Contul se păstrează cel puțin 3 luni, ca măsură de siguranță: dacă l-ai șters din greșeală, scrie-ne prin [formularul de suport](/suport) în acest timp și ți-l restaurăm, cu tot ce s-a șters odată cu el.',
        'După 3 luni, un administrator îl șterge definitiv, așa cum ai ales: ștergem emailul, numele, pozele, parola, legătura cu Google, aprecierile, articolele salvate, reacțiile, notificările, dispozitivele, autorii urmăriți și abonarea la newsletter, plus comentariile (cu răspunsurile la ele) și articolele pe care ai ales să le ștergi. Articolele pe care ai ales să le păstrezi trec pe numele altui autor. Adresa de email poate fi folosită din nou pentru un cont nou.',
      ],
    },
    {
      id: 'drepturi',
      title: '11. Drepturile tale',
      paragraphs: [
        'Conform GDPR, ai dreptul să afli ce date avem despre tine și să le primești într-un format portabil (Profil → „Descarcă datele mele”), să le corectezi (din Profil), să ceri ștergerea lor (ștergerea contului), să ceri restricționarea prelucrării și să te opui prelucrării. Îți poți retrage oricând acordul pentru statistici, din linkul „Cookie-uri” din subsolul paginii.',
        'Pentru oricare dintre acestea scrie-ne prin [formularul de suport](/suport). Dacă ești nemulțumit(ă), poți depune o plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal ([dataprotection.ro](https://www.dataprotection.ro)).',
      ],
    },
    {
      id: 'modificari',
      title: '12. Modificări',
      paragraphs: [
        'Putem actualiza acești termeni; data ultimei actualizări e în partea de sus a paginii. Dacă schimbările sunt importante, te anunțăm pe site.',
      ],
    },
  ],
};

const en: TermsText = {
  updatedLabel: 'Last updated',
  intro: [
    `Welcome to ${site.name}. By using the site you agree to these terms. Below we also explain, plainly, what data we keep about you, why, and for how long.`,
  ],
  sections: [
    {
      id: 'cine-suntem',
      title: '1. Who we are',
      paragraphs: [`The site is run by ${site.company} ("we"). For any question about these terms or your data, write to us through the [support form](/suport)${site.contactEmail ? ` or at ${site.contactEmail}` : ''}.`],
    },
    {
      id: 'continut',
      title: '2. The articles',
      paragraphs: [
        `The articles are written by the site’s authors and belong to them and to ${site.company}. You may read them, share them by link and quote them briefly with a reference to the source; copying them in full or republishing them without our consent is not allowed.`,
        'The content is for information and inspiration. Articles about astrology, psychology, health or spirituality are no substitute for the advice of a doctor, psychologist, financial adviser or other professional.',
      ],
    },
    {
      id: 'cont',
      title: '3. Your account',
      items: [
        'You can create an account with Google or with an email and password. You must be at least 16.',
        'Your account details must be yours and true. An account belongs to one person.',
        'You confirm your email address through the link we send you; that way you can get back into your account if you forget your password.',
        'You are responsible for what is done from your account. Keep your password to yourself; if you think someone else knows it, change it in Profile (it signs you out of your other devices).',
      ],
    },
    {
      id: 'comentarii',
      title: '4. Comments and community rules',
      paragraphs: ['We want warm, respectful discussions. Not allowed:'],
      items: [
        'spam, advertising and misleading links;',
        'harassment, insults, threats or personal attacks;',
        'hate speech or discrimination;',
        'content that is illegal, obscene or infringes others’ rights (including someone else’s personal data).',
      ],
    },
    {
      id: 'moderare',
      title: '5. Moderation and suspension',
      paragraphs: [
        'Any signed-in reader can report a comment. Administrators review reports and may delete comments that break the rules.',
        'Some comments may wait for an administrator’s approval before they show (an account’s first comment, for example, or one with a link or a filtered word); until then only you see them. Comments with forbidden content may be refused outright.',
        'For repeated or serious breaches we may suspend an account, for a period or until the suspension is lifted. You get an email with the reason and how long it lasts; while suspended, the account can’t sign in, and when trying to, you see how long the suspension lasts and why. If it’s a mistake, write to us through the [support form](/suport).',
      ],
    },
    {
      id: 'date',
      title: '6. What data we keep',
      paragraphs: ['We keep only what the site needs to work and, with your consent, reading statistics. We don’t sell data and we show no ads.'],
      table: {
        head: ['What', 'Details', 'Why'],
        rows: [
          [
            'Your account',
            'Email, name, username, profile picture (uploaded by you or from Google), occupation and quote (authors), your password — only as a cryptographic hash, never in plain text —, whether you connected Google (the Google account’s identifier), your role, whether your address is confirmed, when you agreed to the terms, when you created your account and last signed in, your notification and privacy settings, the addresses, names and usernames you had before (with when they changed).',
            'So you can have an account (contract).',
          ],
          [
            'What you do on the site',
            'Comments (and their versions before editing), reactions, likes (including ones taken back, as history), saved articles, the authors you follow, reports you sent, notifications (including when someone mentions you). For authors: the articles’ earlier versions (at most 50 per article), who saved them and when.',
            'So the site works, and for moderation (contract, legitimate interest).',
          ],
          [
            'Signing in',
            'A session on your device; the database keeps only a hash of it, for 30 days, with the browser (e.g. “Chrome · Windows”). Each attempt to sign in: when, the address typed, how (password, Google, a link) and whether it worked, with the browser. We don’t keep the IP address.',
            'So you stay signed in, and to keep accounts safe (contract, legitimate interest).',
          ],
          ['Push notifications', 'If you turn them on: the delivery address your browser gives and its keys, which notifications you want.', 'To send the notifications you asked for (consent).'],
          [
            'Support',
            'Your email, name (optional), message and attached files.',
            'So we can answer you; if you write signed in, the conversation (your messages and our answers) stays in your account too (legitimate interest).',
          ],
          [
            'Newsletter',
            'Only if you subscribe: your email address, whether you want every new post or only the new chapters of some books (and which), the language, when you subscribed and confirmed, which posts we sent you. Every email has an unsubscribe link.',
            'To send you the posts you asked for (consent).',
          ],
          [
            'Invitations',
            'If an administrator invites you to write: your address, their message, who sent it and whether you accepted.',
            'So you can become an author (legitimate interest).',
          ],
          [
            'Searches',
            'The words searched for on the site and how many results they had, counted per day, with nothing about who searched.',
            'To know what readers look for (legitimate interest).',
          ],
          [
            'Emails sent',
            'For each email (confirming your address, a new password, the newsletter and so on): the address, the subject, when, and whether it went out.',
            'So we know emails arrive (legitimate interest).',
          ],
          [
            'Administrators’ actions',
            'What administrators did to an account, comment or article (a suspension, for example), who and when.',
            'So moderation is transparent and can be checked (legitimate interest).',
          ],
          [
            'Statistics',
            'Only with your consent: a random identifier in a cookie, a fingerprint worked out from your IP address, browser and language (with a secret key; the IP address isn’t kept), the page, the day, the site you came from (its domain only), your device type, how long and how far you read, and actions such as likes, shares and saves.',
            'To know what is read and write better articles (consent).',
          ],
        ],
      },
    },
    {
      id: 'cookie-uri',
      title: '7. Cookies and browser storage',
      paragraphs: [
        'Without your consent we use only what is strictly necessary. Without consent to statistics, visiting an article only adds one to its view counter, with nothing linked to you.',
      ],
      table: {
        head: ['Name', 'What for', 'How long'],
        rows: [
          ['sid', 'Keeps you signed in. Necessary.', '30 days'],
          ['consent', 'Your choice on the cookie banner. Necessary.', '6 months'],
          ['oauth_*', 'While signing in with Google. Necessary.', '10 minutes'],
          ['vid', 'Statistics, only with your consent; otherwise only when you like an article without an account, to remember your like.', '13 months'],
          ['Local storage', 'Theme, language, saved articles and likes without an account, the editor’s backup of drafts, whether you closed the install invitation.', 'Until you clear them in your browser'],
        ],
      },
    },
    {
      id: 'terti',
      title: '8. Outside services',
      items: [
        'Google: if you sign in with Google, we receive the account’s name, email and picture from Google. The site’s fonts are hosted on the site, not by Google.',
        'YouTube videos in articles use the “no cookies” mode; when you play one, YouTube may store data in your browser.',
        'Authors can search Wikimedia Commons and Openverse for banner images: the search goes from their browser straight to them. The image chosen (and one brought from another site by its address) is downloaded by our server and kept on the site, so readers don’t connect to those sites.',
        'Push notifications are delivered by your browser’s services (Google, Apple, Mozilla).',
        'Emails (confirming your address, a new password, changing your address, deleting and restoring your account, invitations and the newsletter) go out through our email provider. You get the newsletter only if you subscribe and confirm; we send no ads.',
        'The site is hosted on servers we rent; data isn’t sold and isn’t given to anyone beyond these providers, only as far as their service needs, or when the law requires it.',
      ],
    },
    {
      id: 'pastrare',
      title: '9. How long we keep data',
      items: [
        'Your account and what you do on the site: as long as you have an account.',
        'After you delete your account: at least 3 months (see below); then an administrator deletes it for good, as you chose.',
        'Support tickets: at most 2 years.',
        'Statistics: at most 25 months.',
        'The history of emails sent: 90 days. The log of administrators’ actions: 2 years.',
        'Your newsletter subscription: until you unsubscribe (the address then stays marked as unsubscribed so we don’t write again; we delete it on request). An unconfirmed subscription: 30 days. Which posts we sent you: a year.',
        'Searches (counted per day): at most 25 months. Invitations: a year.',
        'Sessions: 30 days; the record of them (when you signed in, and when and why the sign-in ended): 90 days more. Sign-in attempts: 90 days. Links in emails work once, from one hour to 48 hours; the record of them (when they were sent, used or stopped): 90 days.',
        'Push notifications sent (what, and to how many devices) and the server’s technical errors: 90 days.',
        'The email addresses, names and usernames you had before: as long as you have an account.',
        'After these periods, an administrator deletes the data: the site deletes nothing by itself, but administrators are told when there is something to delete.',
      ],
    },
    {
      id: 'stergere',
      title: '10. Deleting your account',
      paragraphs: [
        'You can delete your account at any time in Profile → “Delete account”, after confirming. You choose what happens to your comments (they stay without your name, or are deleted with the replies to them) and, if you’re an author, to your articles (they stay on the site, or are deleted). What happens:',
      ],
      items: [
        'You are signed out on every device and can’t sign in any more. When trying to, you see the date from which the account can be deleted for good. The newsletter stops too.',
        'Your name and picture disappear from the site. The comments you choose to keep show as “Deleted account”, so the discussions around them still make sense; the ones you choose to delete (and your articles, if you choose so) disappear at once.',
        'The account is kept for at least 3 months as a safety measure: if you deleted it by mistake, write to us through the [support form](/suport) in that time and we will restore it, with everything deleted along with it.',
        'After 3 months, an administrator deletes it for good, as you chose: we delete your email, name, pictures, password, Google connection, likes, saved articles, reactions, notifications, devices, the authors you follow and your newsletter subscription, and the comments (with the replies to them) and articles you chose to delete. The articles you chose to keep move to another author’s name. The email address can be used again for a new account.',
      ],
    },
    {
      id: 'drepturi',
      title: '11. Your rights',
      paragraphs: [
        'Under the GDPR you have the right to know what data we hold about you and to receive it in a portable format (Profile → “Download my data”), to correct it (in Profile), to have it erased (deleting your account), to restrict its processing and to object to its processing. You can withdraw your consent to statistics at any time through the “Cookies” link at the bottom of the page.',
        'For any of these, write to us through the [support form](/suport). If you are unhappy, you can complain to the Romanian data protection authority, ANSPDCP ([dataprotection.ro](https://www.dataprotection.ro)).',
      ],
    },
    {
      id: 'modificari',
      title: '12. Changes',
      paragraphs: ['We may update these terms; the date of the last update is at the top of the page. If the changes are important, we will say so on the site.'],
    },
  ],
};

export const TERMS: Record<Lang, TermsText> = { ro, en };
