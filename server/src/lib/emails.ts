import { config } from '@/config';
import type { Mail } from '@/lib/mail';
import { site } from '@/lib/siteIdentity';

// The emails the site sends, in the language the person was using (Romanian unless they chose English).

export type Lang = 'ro' | 'en';
export const langOf = (value: unknown): Lang => (value === 'en' ? 'en' : 'ro');

const origin = () => config.appUrl.replace(/\/+$/, '');
export const siteLink = (path: string) => `${origin()}${path}`;

const escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const formatDay = (date: Date, lang: Lang) =>
  new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'ro-RO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: site.timeZone }).format(date);

interface Content {
  subject: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Small print under the button. */
  note?: string;
  /** Posts, each with its picture, title, summary and link (the newsletter). */
  posts?: { title: string; summary: string; url: string; image: string | null }[];
  /** The footer's own line instead of "because of your account" (the newsletter: how to unsubscribe). */
  footer?: { text: string; linkLabel: string; url: string };
}

/** The same layout for every email: the site's name on the midnight sky, the text, one button. */
function render(to: string, lang: Lang, content: Content, kind: string): Mail {
  const footer = content.footer
    ? `${content.footer.text} <a href="${escape(content.footer.url)}" style="color:#5b4bd6">${escape(content.footer.linkLabel)}</a>`
    : escape(lang === 'en' ? `You're receiving this email because of your account on ${site.name}.` : `Primești acest email pentru contul tău de pe ${site.name}.`);
  const postsText = (content.posts ?? []).flatMap((p) => [p.title, p.summary, p.url, '']);
  const postsHtml = (content.posts ?? [])
    .map(
      (p) => `<tr><td style="padding:10px 28px">
          ${p.image ? `<a href="${escape(p.url)}"><img src="${escape(p.image)}" alt="" width="464" style="display:block;width:100%;max-width:464px;border-radius:10px;margin:0 0 10px"></a>` : ''}
          <a href="${escape(p.url)}" style="font-family:Georgia,serif;font-size:19px;line-height:1.3;color:#111526;text-decoration:none;font-weight:bold">${escape(p.title)}</a>
          <p style="margin:6px 0 0;font-size:14px;line-height:1.55;color:#4b5066">${escape(p.summary)}</p>
        </td></tr>`,
    )
    .join('\n        ');
  const text = [
    content.heading,
    '',
    ...content.paragraphs.flatMap((p) => [p, '']),
    ...postsText,
    ...(content.button ? [`${content.button.label}: ${content.button.url}`, ''] : []),
    ...(content.note ? [content.note, ''] : []),
    '—',
    `${site.name} · ${origin()}`,
    ...(content.footer ? [`${content.footer.text} ${content.footer.linkLabel}: ${content.footer.url}`] : []),
  ].join('\n');

  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#eef0f6;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1d2233">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f6;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden">
        <tr><td style="background:#050918;padding:22px 28px;color:#f3e7c9;font-family:Georgia,serif;font-size:22px;letter-spacing:.5px">${escape(site.name)}</td></tr>
        <tr><td style="padding:28px 28px 8px">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#111526">${escape(content.heading)}</h1>
          ${content.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${escape(p)}</p>`).join('\n          ')}
        </td></tr>
        ${postsHtml}
        ${
          content.button
            ? `<tr><td style="padding:8px 28px 4px"><a href="${escape(content.button.url)}" style="display:inline-block;background:#5b4bd6;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${escape(content.button.label)}</a></td></tr>
        <tr><td style="padding:10px 28px 0;font-size:12px;line-height:1.5;color:#6b7086;word-break:break-all">${escape(content.button.url)}</td></tr>`
            : ''
        }
        ${content.note ? `<tr><td style="padding:16px 28px 0;font-size:13px;line-height:1.5;color:#6b7086">${escape(content.note)}</td></tr>` : ''}
        <tr><td style="padding:24px 28px 26px;font-size:12px;color:#8a8fa3">${footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { to, subject: `${content.subject} · ${site.name}`, text, html, kind };
}

export function verifyEmail(to: string, lang: Lang, name: string, url: string) {
  return render(to, lang, lang === 'en'
    ? {
        subject: 'Confirm your email address',
        heading: `Hi, ${name}!`,
        paragraphs: [`Please confirm that ${to} is your address, so you can get back into your account if you ever forget your password.`],
        button: { label: 'Confirm my address', url },
        note: "The link works for 48 hours. If you didn't create this account, you can ignore this email.",
      }
    : {
        subject: 'Confirmă adresa de email',
        heading: `Bună, ${name}!`,
        paragraphs: [`Confirmă că ${to} este adresa ta, ca să-ți poți recupera contul dacă îți uiți vreodată parola.`],
        button: { label: 'Confirmă adresa', url },
        note: 'Linkul este valabil 48 de ore. Dacă nu tu ți-ai creat contul, ignoră acest email.',
      }, 'verify');
}

export function resetEmail(to: string, lang: Lang, name: string, url: string) {
  return render(to, lang, lang === 'en'
    ? {
        subject: 'Choose a new password',
        heading: `Hi, ${name}!`,
        paragraphs: ['Someone (hopefully you) asked for a new password for your account.'],
        button: { label: 'Choose a new password', url },
        note: "The link works for one hour. If you didn't ask for it, ignore this email: your password stays the same.",
      }
    : {
        subject: 'Alege o parolă nouă',
        heading: `Bună, ${name}!`,
        paragraphs: ['Cineva (sperăm că tu) a cerut o parolă nouă pentru contul tău.'],
        button: { label: 'Alege o parolă nouă', url },
        note: 'Linkul este valabil o oră. Dacă nu ai cerut tu, ignoră emailul: parola rămâne aceeași.',
      }, 'reset');
}

export function changeEmail(to: string, lang: Lang, name: string, url: string) {
  return render(to, lang, lang === 'en'
    ? {
        subject: 'Confirm your new email address',
        heading: `Hi, ${name}!`,
        paragraphs: [`You asked for ${to} to become your account's address. Confirm it to finish the change.`],
        button: { label: 'Confirm the new address', url },
        note: "The link works for 24 hours. Until then, your account keeps its old address. If you didn't ask for this, ignore this email.",
      }
    : {
        subject: 'Confirmă noua adresă de email',
        heading: `Bună, ${name}!`,
        paragraphs: [`Ai cerut ca ${to} să devină adresa contului tău. Confirm-o ca să termini schimbarea.`],
        button: { label: 'Confirmă adresa nouă', url },
        note: 'Linkul este valabil 24 de ore. Până atunci, contul rămâne pe adresa veche. Dacă nu ai cerut tu, ignoră emailul.',
      }, 'change');
}

export function deletedEmail(to: string, lang: Lang, name: string, purgeOn: Date) {
  const day = formatDay(purgeOn, lang);
  return render(to, lang, lang === 'en'
    ? {
        subject: 'Your account was deleted',
        heading: `Goodbye, ${name}`,
        paragraphs: [
          `Your ${site.name} account was deleted at your request. We keep it at least until ${day}; after that it can be deleted for good, as you chose.`,
          'If this was a mistake, write to us through the support form before then and we will restore it.',
        ],
        button: { label: 'Support form', url: siteLink('/suport') },
      }
    : {
        subject: 'Contul tău a fost șters',
        heading: `La revedere, ${name}`,
        paragraphs: [
          `Contul tău de pe ${site.name} a fost șters la cererea ta. Îl păstrăm cel puțin până pe ${day}; după aceea poate fi șters definitiv, așa cum ai ales.`,
          'Dacă a fost o greșeală, scrie-ne prin formularul de suport până atunci și ți-l restaurăm.',
        ],
        button: { label: 'Formularul de suport', url: siteLink('/suport') },
      }, 'deleted');
}

export function restoredEmail(to: string, lang: Lang, name: string) {
  return render(to, lang, lang === 'en'
    ? {
        subject: 'Your account was restored',
        heading: `Welcome back, ${name}!`,
        paragraphs: ['Your account was restored. You can sign in again, as before.'],
        button: { label: 'Sign in', url: siteLink('/login') },
      }
    : {
        subject: 'Contul tău a fost restaurat',
        heading: `Bine ai revenit, ${name}!`,
        paragraphs: ['Contul tău a fost restaurat. Te poți conecta din nou, ca înainte.'],
        button: { label: 'Conectează-te', url: siteLink('/login') },
      }, 'restored');
}

export function suspendedEmail(to: string, lang: Lang, name: string, until: Date | null, reason: string | null) {
  const when = until ? formatDay(until, lang) : null;
  return render(to, lang, lang === 'en'
    ? {
        subject: 'Your account was suspended',
        heading: `Hi, ${name}`,
        paragraphs: [
          when ? `Your ${site.name} account is suspended until ${when}. Until then you can’t sign in.` : `Your ${site.name} account is suspended until an administrator lifts it. Until then you can’t sign in.`,
          ...(reason ? [`Reason: ${reason}`] : []),
          'If you think it’s a mistake, write to us through the support form.',
        ],
        button: { label: 'Support form', url: siteLink('/suport') },
      }
    : {
        subject: 'Contul tău a fost suspendat',
        heading: `Bună, ${name}`,
        paragraphs: [
          when ? `Contul tău de pe ${site.name} este suspendat până pe ${when}. Până atunci nu te poți conecta.` : `Contul tău de pe ${site.name} este suspendat până când un administrator ridică suspendarea. Până atunci nu te poți conecta.`,
          ...(reason ? [`Motivul: ${reason}`] : []),
          'Dacă crezi că e o greșeală, scrie-ne prin formularul de suport.',
        ],
        button: { label: 'Formularul de suport', url: siteLink('/suport') },
      }, 'suspended');
}

// ---- The newsletter and invitations

export interface NewsletterPost {
  title: string;
  summary: string;
  url: string;
  image: string | null;
  /** A chapter: its book's title. */
  book: string | null;
}

/** The unsubscribe line and header of every newsletter email (RFC 8058: one click from the mail app). */
function unsubscribe(lang: Lang, manageUrl: string, unsubscribeUrl: string) {
  return {
    footer:
      lang === 'en'
        ? { text: `You get this because you subscribed on ${site.name}.`, linkLabel: 'Change or unsubscribe', url: manageUrl }
        : { text: `Primești emailul pentru că te-ai abonat pe ${site.name}.`, linkLabel: 'Schimbă sau dezabonează-te', url: manageUrl },
    headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

/** Confirming a subscription: to every new post, or (`book`) to a book's new chapters. */
export function newsletterConfirmEmail(to: string, lang: Lang, url: string, book: string | null) {
  return render(to, lang, lang === 'en'
    ? {
        subject: 'Confirm your subscription',
        heading: 'One more step',
        paragraphs: [book ? `Confirm that you want an email at ${to} when a new chapter of “${book}” is out.` : `Confirm that you want ${site.name}'s new articles at ${to}.`],
        button: { label: 'Confirm the subscription', url },
        note: "If you didn't ask for it, ignore this email: you won't get anything.",
      }
    : {
        subject: 'Confirmă abonarea',
        heading: 'Încă un pas',
        paragraphs: [book ? `Confirmă că vrei un email la ${to} când apare un capitol nou din „${book}”.` : `Confirmă că vrei articolele noi de pe ${site.name} la ${to}.`],
        button: { label: 'Confirmă abonarea', url },
        note: 'Dacă nu ai cerut tu, ignoră emailul: nu vei primi nimic.',
      }, 'newsletter_confirm');
}

/** A new post (or a book's new chapter), as it's out. */
export function newsletterPostEmail(to: string, lang: Lang, post: NewsletterPost, manageUrl: string, unsubscribeUrl: string) {
  const extra = unsubscribe(lang, manageUrl, unsubscribeUrl);
  const en = lang === 'en';
  const mail = render(
    to,
    lang,
    {
      subject: post.book ? `${post.book}: ${post.title}` : post.title,
      heading: post.book ? (en ? `A new chapter of “${post.book}”` : `Un capitol nou din „${post.book}”`) : en ? 'A new article' : 'Un articol nou',
      paragraphs: [],
      posts: [post],
      button: { label: post.book ? (en ? 'Read the chapter' : 'Citește capitolul') : en ? 'Read the article' : 'Citește articolul', url: post.url },
      footer: extra.footer,
    },
    'newsletter_post',
  );
  return { ...mail, headers: extra.headers };
}

export function inviteEmail(to: string, lang: Lang, inviter: string, message: string | null, url: string) {
  return render(to, lang, lang === 'en'
    ? {
        subject: `You're invited to write on ${site.name}`,
        heading: 'An invitation to write',
        paragraphs: [`${inviter} invites you to write articles on ${site.name}.`, ...(message ? [`“${message}”`] : [])],
        button: { label: 'Accept the invitation', url },
        note: 'The link works for 14 days.',
      }
    : {
        subject: `Ești invitat(ă) să scrii pe ${site.name}`,
        heading: 'O invitație să scrii',
        paragraphs: [`${inviter} te invită să scrii articole pe ${site.name}.`, ...(message ? [`„${message}”`] : [])],
        button: { label: 'Acceptă invitația', url },
        note: 'Linkul este valabil 14 zile.',
      }, 'invite');
}

/**
 * An administrator's answer to a support ticket: their text, and (sent signed in) the conversation in the app, where
 * the person answers back; else a way to write again. Answering by email reaches the site's contact address, when
 * it has one (Reply-To).
 */
export function supportReplyEmail(to: string, lang: Lang, reply: { title: string; body: string; url: string | null }) {
  const paragraphs = reply.body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const mail = render(to, lang, lang === 'en'
    ? {
        subject: `Re: ${reply.title}`,
        heading: 'An answer from support',
        paragraphs: [`About “${reply.title}”:`, ...paragraphs],
        button: reply.url ? { label: 'See the conversation', url: reply.url } : { label: 'Write to us again', url: siteLink('/suport') },
        note: reply.url ? 'You can answer from your account: the whole conversation stays there.' : 'Signed in, you would find our answers in your account too, with the whole conversation.',
        footer: { text: `You're receiving this email because you wrote to ${site.name}'s support.`, linkLabel: 'Support', url: siteLink('/suport') },
      }
    : {
        subject: `Re: ${reply.title}`,
        heading: 'Un răspuns de la suport',
        paragraphs: [`Despre „${reply.title}”:`, ...paragraphs],
        button: reply.url ? { label: 'Vezi conversația', url: reply.url } : { label: 'Scrie-ne din nou', url: siteLink('/suport') },
        note: reply.url ? 'Poți răspunde din cont: toată conversația rămâne acolo.' : 'Dacă ne scrii autentificat, găsești răspunsurile și în cont, cu toată conversația.',
        footer: { text: `Primești acest email pentru că ai scris la suportul ${site.name}.`, linkLabel: 'Suport', url: siteLink('/suport') },
      }, 'support_reply');
  return site.contactEmail ? { ...mail, headers: { 'Reply-To': site.contactEmail } } : mail;
}

export function testEmail(to: string) {
  return render(to, 'ro', {
    subject: 'Email de test',
    heading: 'Setările de email funcționează',
    paragraphs: [`Acesta este un email de test trimis din panoul de administrare ${site.name}. Dacă îl citești, serverul SMTP e configurat corect.`],
  }, 'test');
}
