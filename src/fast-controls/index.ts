// Ephemeral fast controls: one renderer-neutral schema, interaction model and answer text, shared by
// every Ripple renderer (React Native in Dash, the web review surface, Tern over TSP).

export { intentText } from './message.js'
export {
  type ControlCandidate,
  type ControlOption,
  describeIntent,
  type FastControl,
  type FastControlKind,
  type Intent,
  LIMITS,
  MAX_OPTIONS,
  parseFastControl,
  parseIntent
} from './schema.js'
export {
  type ControlInput,
  type ControlState,
  initialState,
  intentOf,
  type Outcome,
  rowsOf,
  snap,
  type Step,
  step,
  stepOf
} from './state.js'
