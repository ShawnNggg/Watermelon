import { Rive, RuntimeLoader } from '@rive-app/canvas';
import type { AvatarRenderer } from './renderer';
import type { Intent, Prop, Fx, Variant } from './types';

export interface RiveDogOptions {
  canvas: HTMLCanvasElement;
  src: string;                 // e.g. '/assets/dog.riv'
  wasmUrl?: string;            // local rive.wasm so it works offline
  stateMachine?: string;       // default 'DogSM'
  timeoutMs?: number;
}

const PROPS: Prop[] = [
  'laptop', 'phone', 'coffee', 'phones', 'snack', 'bag', 'glasses',
  'paper', 'telephone', 'fishing_rod', 'takeout', 'tea_cup',
  'cash', 'watch', 'drink', 'blanket', 'lunchbox', 'festival_hat',
];
const VARIANTS: Variant[] = ['dark_circles', 'back_turn'];
const FX: Fx[] = ['z', 'heart', 'surprise', 'sweat', 'money', 'sparkle'];

type SMInput = { name: string; value?: number | boolean; fire?: () => void };

export class AvatarRiveRenderer implements AvatarRenderer {
  private missing = new Set<string>();

  private constructor(private rive: Rive, private inputs: Map<string, SMInput>) {}

  static create(opts: RiveDogOptions): Promise<AvatarRiveRenderer> {
    if (opts.wasmUrl) RuntimeLoader.setWasmUrl(opts.wasmUrl);
    const sm = opts.stateMachine ?? 'DogSM';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Rive load timeout')), opts.timeoutMs ?? 8000);
      const rive: Rive = new Rive({
        src: opts.src,
        canvas: opts.canvas,
        stateMachines: sm,
        autoplay: true,
        onLoad: () => {
          clearTimeout(timer);
          rive.resizeDrawingSurfaceToCanvas();
          const list = (rive.stateMachineInputs(sm) ?? []) as SMInput[];
          if (list.length === 0) return reject(new Error(`State machine "${sm}" not found or has no inputs`));
          resolve(new AvatarRiveRenderer(rive, new Map(list.map((i) => [i.name, i]))));
        },
        onLoadError: (e: unknown) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
      });
    });
  }

  private num(name: string, v: number) {
    const i = this.inputs.get(name);
    if (i) i.value = v; else this.warn(name);
  }
  private bool(name: string, v: boolean) {
    const i = this.inputs.get(name);
    if (i) i.value = v; else this.warn(name);
  }
  private fire(name: string) {
    const i = this.inputs.get(name);
    if (i?.fire) i.fire(); else this.warn(name);
  }
  /** Gray-box files won't have every input yet: warn once per missing input instead of throwing. */
  private warn(name: string) {
    if (!this.missing.has(name)) { this.missing.add(name); console.warn(`[RiveDog] missing input: ${name}`); }
  }

  apply(intent: Intent): void {
    if (intent.pose !== null) this.num('pose', intent.pose);
    this.num('mood', intent.mood);
    for (const p of PROPS) this.bool(`p_${p}`, intent.props.includes(p));
    const variants = intent.variants ?? [];
    for (const v of VARIANTS) this.bool(`v_${v}`, variants.includes(v));
    if (intent.tailSpeed !== undefined) this.num('tailSpeed', intent.tailSpeed);
    this.num('action', intent.action);
    if (intent.action > 0) this.fire('play');
    for (const f of FX) if (intent.fx.includes(f)) this.fire(`fx_${f}`);
  }

  setLook(x: number, y: number) { this.num('lookX', clamp(x)); this.num('lookY', clamp(y)); }
  setDrag(on: boolean) { this.bool('drag', on); }
  tap() { this.fire('tap'); }
  /** 画布尺寸变化后重新对齐 drawing surface（窗口/布局变动时调用） */
  resize() { this.rive.resizeDrawingSurfaceToCanvas(); }
  pause() { this.rive.pause(); }
  resume() { this.rive.play(); }
  destroy() { this.rive.cleanup(); }
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
