import { VALUE_MESSAGES, type ValueMessage } from "@necodoc/shared";
import type { z } from "zod";

// Spec: docs/features/document-localization.md ("Form text"). The guided form's and share page's
// own text in the document language. Template text (labels, name, description) comes from the
// template's translation tables instead. A new language is a new table; `UiStrings` makes it
// complete. French is written for Québec (OQLF typography: a no-break space before colons only).

const plural = (n: string, one: string, many: string) => `${n} ${n === "1" ? one : many}`;

const en = {
  /** Language picker's accessible name. */
  language: "Language",
  next: "Next",
  back: "Back",
  step: (n: number, total: number) => `Step ${n} of ${total}`,
  review: "Review",
  reviewTitle: "Review your answers",
  reviewHelp: "Check everything before you finish.",
  edit: "Edit",
  submit: "Submit",
  sending: "Sending…",
  finish: "Finish and make PDF",
  finishing: "Making your PDF…",
  noFields: "This template doesn't declare any fields.",
  prefilled: "Filled in for you.",
  addItem: (label: string) => `Add ${label.toLowerCase()}`,
  removeItem: (item: string) => `Remove ${item}`,
  fixFields: (above: boolean) => `Fix the highlighted fields${above ? " above" : ""}.`,
  choose: "Choose…",
  remove: "Remove",
  none: "None",
  notAnswered: "Not answered",
  yes: "Yes",
  no: "No",
  signature: {
    pad: (label: string) => `${label} pad: draw your signature, or type it instead`,
    typeLabel: (label: string) => `Type your name to sign (${label})`,
    typePlaceholder: "Type your full name",
    signed: "Signed.",
    signHere: "Sign in the box.",
    typeInsteadLabel: (label: string) => `Type ${label} instead`,
    typeInstead: "Type instead",
    clearLabel: (label: string) => `Clear ${label}`,
    clear: "Clear",
  },
  /** Validation messages; numbers and dates arrive formatted for the language. */
  invalid: {
    messages: VALUE_MESSAGES as Record<ValueMessage, string>,
    minLength: (n: string) => `Enter at least ${plural(n, "character", "characters")}`,
    maxLength: (n: string) => `Use at most ${plural(n, "character", "characters")}`,
    min: (n: string) => `Must be at least ${n}`,
    max: (n: string) => `Must be at most ${n}`,
    minItems: (n: string) => `Needs at least ${plural(n, "item", "items")}`,
    maxItems: (n: string) => `Allows at most ${plural(n, "item", "items")}`,
    wholeNumber: "Enter a whole number",
    number: "Enter a number",
    email: "Enter a valid email address",
    date: "Enter a valid date",
    decimals: (n: string) => `Use at most ${plural(n, "decimal place", "decimal places")}`,
    onOrAfter: (date: string) => `Must be on or after ${date}`,
    onOrBefore: (date: string) => `Must be on or before ${date}`,
    /** Anything else; English shows the validator's own message instead. */
    other: "Check this answer",
  },
  share: {
    goneTitle: "This link is no longer available",
    gone: "It may have expired, reached its limit, or been turned off. Ask whoever sent it to you for a new one.",
    failedTitle: "We couldn't open this form",
    failed: "Check your connection and try again. Your answers so far are kept in this browser.",
    tryAgain: "Try again",
    trying: "Trying…",
    loading: "Loading",
    sentTitle: "Thanks, your answers were sent",
    download: "Download your PDF",
    sentError:
      "We received your answers, but the PDF couldn't be made. The person who sent the link has them.",
    sentDownload: "Download a copy of the completed PDF. The link works for 24 hours.",
    sentDone: "The person who sent the link has your answers and the PDF. You can close this page.",
    sentPending:
      "The PDF is still being made; the person who sent the link will have it shortly. You can close this page.",
    note: "Your answers go to whoever sent you this link. Until you submit, they're saved only in this browser.",
    emailLabel: "Your email address",
    emailHelp: "The person who sent this link asks for it so they know who answered.",
    emailInvalid: "That doesn't look like an email address",
    emailMissing: "Enter your email address",
  },
};

export type UiStrings = typeof en;

const fr: UiStrings = {
  language: "Langue",
  next: "Suivant",
  back: "Précédent",
  step: (n, total) => `Étape ${n} sur ${total}`,
  review: "Vérification",
  reviewTitle: "Vérifiez vos réponses",
  reviewHelp: "Relisez tout avant de terminer.",
  edit: "Modifier",
  submit: "Envoyer",
  sending: "Envoi en cours…",
  finish: "Terminer et produire le PDF",
  finishing: "Production du PDF…",
  noFields: "Ce modèle ne comporte aucun champ.",
  prefilled: "Rempli pour vous.",
  addItem: (label) => `Ajouter : ${label.toLowerCase()}`,
  removeItem: (item) => `Retirer ${item}`,
  fixFields: (above) => `Corrigez les champs en évidence${above ? " ci-dessus" : ""}.`,
  choose: "Choisissez…",
  remove: "Retirer",
  none: "Aucun",
  notAnswered: "Sans réponse",
  yes: "Oui",
  no: "Non",
  signature: {
    pad: (label) => `Zone ${label} : dessinez votre signature ou tapez-la`,
    typeLabel: (label) => `Tapez votre nom pour signer (${label})`,
    typePlaceholder: "Tapez votre nom complet",
    signed: "Signé.",
    signHere: "Signez dans le cadre.",
    typeInsteadLabel: (label) => `Taper ${label} plutôt`,
    typeInstead: "Taper plutôt",
    clearLabel: (label) => `Effacer ${label}`,
    clear: "Effacer",
  },
  invalid: {
    messages: {
      required: "Obligatoire",
      pattern: "Le format attendu n'est pas respecté",
      pickOne: "Choisissez une des options",
      pickOnce: "Choisissez chaque option une seule fois",
      image: "Téléversez une image PNG, JPEG ou WebP",
      signature: "Ajoutez votre signature",
    },
    minLength: (n) => `Entrez au moins ${plural(n, "caractère", "caractères")}`,
    maxLength: (n) => `Utilisez au plus ${plural(n, "caractère", "caractères")}`,
    min: (n) => `Doit être d'au moins ${n}`,
    max: (n) => `Doit être d'au plus ${n}`,
    minItems: (n) => `Il faut au moins ${plural(n, "élément", "éléments")}`,
    maxItems: (n) => `Au plus ${plural(n, "élément", "éléments")}`,
    wholeNumber: "Entrez un nombre entier",
    number: "Entrez un nombre",
    email: "Entrez une adresse courriel valide",
    date: "Entrez une date valide",
    decimals: (n) => `Utilisez au plus ${plural(n, "décimale", "décimales")}`,
    onOrAfter: (date) => `Doit être le ${date} ou après`,
    onOrBefore: (date) => `Doit être le ${date} ou avant`,
    other: "Vérifiez cette réponse",
  },
  share: {
    goneTitle: "Ce lien n'est plus disponible",
    gone: "Il a peut-être expiré, atteint sa limite ou été désactivé. Demandez-en un nouveau à la personne qui vous l'a envoyé.",
    failedTitle: "Impossible d'ouvrir ce formulaire",
    failed:
      "Vérifiez votre connexion et réessayez. Vos réponses jusqu'ici sont conservées dans ce navigateur.",
    tryAgain: "Réessayer",
    trying: "Nouvel essai…",
    loading: "Chargement",
    sentTitle: "Merci, vos réponses ont été envoyées",
    download: "Télécharger votre PDF",
    sentError:
      "Nous avons reçu vos réponses, mais le PDF n'a pas pu être produit. La personne qui vous a envoyé le lien les a reçues.",
    sentDownload: "Téléchargez une copie du PDF rempli. Le lien est valide pendant 24 heures.",
    sentDone:
      "La personne qui vous a envoyé le lien a reçu vos réponses et le PDF. Vous pouvez fermer cette page.",
    sentPending:
      "Le PDF est en cours de production; la personne qui vous a envoyé le lien le recevra sous peu. Vous pouvez fermer cette page.",
    note: "Vos réponses sont transmises à la personne qui vous a envoyé ce lien. Tant que vous ne les avez pas envoyées, elles sont enregistrées seulement dans ce navigateur.",
    emailLabel: "Votre adresse courriel",
    emailHelp: "La personne qui vous a envoyé ce lien la demande pour savoir qui a répondu.",
    emailInvalid: "Cette adresse courriel ne semble pas valide",
    emailMissing: "Entrez votre adresse courriel",
  },
};

const tables: Readonly<Record<string, UiStrings>> = { en, fr };

/** The table for a language tag: exact tag (`fr-CA`), then its language (`fr`), then English. */
export function uiStrings(lang: string): UiStrings {
  const tag = lang.toLowerCase();
  return tables[tag] ?? tables[tag.split("-")[0] ?? ""] ?? en;
}

/** A field date (`2026-01-15`) as the language writes it: Jan 15, 2026 or 15 janv. 2026. */
export function formatDay(iso: string, lang: string) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "UTC" }).format(date);
  } catch {
    return iso;
  }
}

/** A number as the language writes it (1,234.5 or 1 234,5); anything else as text. */
export function formatNumber(value: unknown, lang: string) {
  if (typeof value !== "number" && typeof value !== "bigint") return String(value);
  try {
    return new Intl.NumberFormat(lang, { maximumFractionDigits: 20 }).format(value);
  } catch {
    return String(value);
  }
}

const messageKeys = new Map(
  Object.entries(VALUE_MESSAGES).map(([key, text]) => [text as string, key as ValueMessage]),
);

/** A validation issue (templateDataSchema) in the language, by its code and params. */
export function issueMessage(issue: z.core.$ZodIssue, lang: string): string {
  const t = uiStrings(lang).invalid;
  const n = (value: unknown) => formatNumber(value, lang);
  const known = messageKeys.get(issue.message);
  if (known) return t.messages[known];
  switch (issue.code) {
    case "too_small":
      if (issue.origin === "string") return t.minLength(n(issue.minimum));
      if (issue.origin === "array") return t.minItems(n(issue.minimum));
      if (issue.origin === "number") return t.min(n(issue.minimum));
      break;
    case "too_big":
      if (issue.origin === "string") return t.maxLength(n(issue.maximum));
      if (issue.origin === "array") return t.maxItems(n(issue.maximum));
      if (issue.origin === "number") return t.max(n(issue.maximum));
      break;
    case "invalid_type":
      if (issue.expected === "int") return t.wholeNumber;
      if (issue.expected === "number") return t.number;
      break;
    case "invalid_format":
      if (issue.format === "email") return t.email;
      if (issue.format === "date") return t.date;
      break;
    case "custom": {
      const { decimals, onOrAfter, onOrBefore } = issue.params ?? {};
      if (decimals !== undefined) return t.decimals(n(decimals));
      if (typeof onOrAfter === "string") return t.onOrAfter(formatDay(onOrAfter, lang));
      if (typeof onOrBefore === "string") return t.onOrBefore(formatDay(onOrBefore, lang));
      break;
    }
  }
  return t === en.invalid ? issue.message : t.other;
}
