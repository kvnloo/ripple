/**
 * One structured line from a spoken note (Quackles portal pattern):
 *   "V2 arrival / C commons canopy / material / warmer timber / severity high / scope: this candidate"
 * Deterministic keyword rules, no model call: the owner confirms with Enter or
 * re-speaks, so the restatement only has to be legible and correctable.
 */

export interface Restatement {
  candidate: string;
  object: string;
  attribute: string;
  direction: string;
  severity: 'low' | 'med' | 'high';
  scope: 'this candidate' | 'this card' | 'all candidates' | 'rule';
  line: string;
}

const ATTRIBUTES: [RegExp, string][] = [
  [/\b(warm|warmer|cool|cooler|colou?r|tint|orange|blue|navy|palette|saturat)/, 'colour'],
  [/\b(bright|brighter|dark|darker|dim|exposure|glow|light(?:ing|s)?|shadow)/, 'light'],
  [/\b(big|bigger|small|smaller|tall|taller|short|shorter|scale|size|huge|tiny|wide|narrow)/, 'scale'],
  [/\b(material|timber|wood|stone|glass|concrete|metal|bronze|texture|finish)/, 'material'],
  [/\b(tree|trees|green|greenery|plants?|planting|foliage|lawn|garden|nature)/, 'greenery'],
  [/\b(people|person|crowd|figures|mannequin)/, 'people'],
  [/\b(camera|angle|framing|composition|crop|view|horizon)/, 'composition'],
  [/\b(shape|form|curve|curved|swoop|roofline|massing|boxy|box|flat)/, 'form'],
  [/\b(detail|details|clutter|busy|empty|barren|plain|boring)/, 'detail'],
];

const DIRECTIONS: [RegExp, string][] = [
  [/\b(remove|delete|get rid|lose|drop|no need|don't need|do not need)\b/, 'remove'],
  [/\b(add|more|another|extra|needs?)\b/, 'add / more'],
  [/\b(less|fewer|reduce|tone down|too much|too many)\b/, 'less'],
  [/\b(warmer)\b/, 'warmer'],
  [/\b(cooler|colder)\b/, 'cooler'],
  [/\b(brighter|lighter)\b/, 'brighter'],
  [/\b(darker|dimmer)\b/, 'darker'],
  [/\b(bigger|larger|taller|wider)\b/, 'bigger'],
  [/\b(smaller|shorter|narrower)\b/, 'smaller'],
  [/\b(keep|love|like|good|great|nice|perfect|lock)\b/, 'keep'],
  [/\b(hate|ugly|bad|wrong|broken|weird|ugh|boring)\b/, 'fix'],
];

const HIGH = /\b(really|very|hate|must|always|never|terrible|awful|critical|definitely|biggest)\b/;
const LOW = /\b(maybe|slightly|a bit|bit|minor|small thing|nitpick|perhaps)\b/;

export function restate(text: string, candidateLabel: string, objectLabel: string | null, ruleTicked = false): Restatement {
  const t = ` ${text.toLowerCase()} `;
  const attribute = ATTRIBUTES.find(([r]) => r.test(t))?.[1] ?? 'general';
  const dirHits = DIRECTIONS.filter(([r]) => r.test(t)).map(([, d]) => d);
  const direction = dirHits.length ? [...new Set(dirHits)].slice(0, 2).join(', ') : 'note';
  const severity: Restatement['severity'] = HIGH.test(t) ? 'high' : LOW.test(t) ? 'low' : 'med';
  let scope: Restatement['scope'] = 'this candidate';
  if (ruleTicked || /\b(rule|always|every time|everywhere|from now on)\b/.test(t)) scope = 'rule';
  else if (/\b(all of them|every one|all three|all options|each option|both)\b/.test(t)) scope = 'all candidates';
  else if (/\b(this (question|card|choice)|for arrival|for the aerial)\b/.test(t)) scope = 'this card';
  const object = objectLabel ?? 'whole image';
  const line = `${candidateLabel} / ${object} / ${attribute} / ${direction} / severity ${severity} / scope: ${scope}`;
  return { candidate: candidateLabel, object, attribute, direction, severity, scope, line };
}
