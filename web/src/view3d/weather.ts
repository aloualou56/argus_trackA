// "See it happen" in the 3D view (README, "3D view"): the weather and the dangers ARGUS rates for a
// place, played out over ARGUS's model of it. Rain and storms, a flood rising, wind blowing dust, heat
// and strong sun, frost, an earthquake, a landslide, damp, fire, smog, plants taking over, visitors.
// Each is an illustration of what the danger is, not a forecast of it (math.ts, effectOf, says which
// danger each one shows). With "less motion" each is a still picture: nothing falls, shakes or flashes.
import * as THREE from "three";
import type { Effect } from "./math";

type Uniform = { value: number };

/** What the weather does to every surface (house.ts draws it on the model and the ground). */
export interface Env {
  /** Wet, darker. */
  wet: Uniform;
  /** Frost and snow on what faces up. */
  frost: Uniform;
  /** Soot and grime. */
  soot: Uniform;
  /** Heat: bleached and warm. */
  heat: Uniform;
  /** Strong sunlight fading the colours. */
  fade: Uniform;
  /** Damp rising in the walls from the floor (base, below), up and down. */
  dampLow: Uniform;
  /** A storm's dark light. */
  dim: Uniform;
  /** A flash of lightning. */
  flash: Uniform;
  /** The ground creeping downhill (metres moved) below a tear across the slope through geoCentre. */
  creep: Uniform;
  /** The ground settling (metres down at the middle) in a dish around geoCentre. */
  sink: Uniform;
  /** Where the ground moves (scene x, z), which way is downhill, and how far round it moves (metres). */
  geoCentre: { value: THREE.Vector2 };
  geoDir: { value: THREE.Vector2 };
  geoR: Uniform;
  /** A cellar caving in (0-1): its roof over the collapse coming down; the ground above sinking into a
   *  hollow; the camera inside a cellar (1: lit by its lamp); where (the floor at the collapse) and how wide. */
  cave: Uniform;
  hollow: Uniform;
  inCellar: Uniform;
  caveC: { value: THREE.Vector3 };
  caveR: Uniform;
}

/** The parts of Env that come and go with the weather (the rest says where). */
const NUMERIC = ["wet", "frost", "soot", "heat", "fade", "dampLow", "dim", "flash", "creep", "sink"] as const;

export function makeEnv(): Env {
  const u = () => ({ value: 0 });
  return {
    wet: u(), frost: u(), soot: u(), heat: u(), fade: u(), dampLow: u(), dim: u(), flash: u(), creep: u(), sink: u(),
    geoCentre: { value: new THREE.Vector2() }, geoDir: { value: new THREE.Vector2(1, 0) }, geoR: { value: 20 },
    cave: u(), hollow: u(), inCellar: u(), caveC: { value: new THREE.Vector3() }, caveR: { value: 2.6 },
  };
}

export interface WeatherContext {
  scene: THREE.Scene;
  /** What the camera looks at now: the weather fills the space around it. */
  target: () => THREE.Vector3;
  /** How far around it, in metres. */
  radius: number;
  /** The height of the model (or the ground where it has none) at scene x, z. */
  surface: (x: number, z: number) => number;
  /** The highest point of the model at scene x, z (a roof, a wall top), else the ground. */
  topAt: (x: number, z: number) => number;
  /** The floor at the damage (scene y). */
  base: number;
  /** Wall tops, where dust and stones come down from. */
  tops: THREE.Vector3[];
  /** Flat floors people walk on. */
  flats: THREE.Vector3[];
  /** Whether something of the model stands between two points. */
  blocked: (a: THREE.Vector3, b: THREE.Vector3) => boolean;
  env: Env;
  /** The plants on the wall tops: how many of them show (0-1), how big (1 = as drawn), how they sway. */
  plants: { show(fraction: number, grow: number): void; sway: Uniform; restore(): void; count: number };
  /** A layer over the picture (glare, haze, a flash): styles.css, ".view3d-fx". */
  overlay: HTMLElement;
  /** Screen pixels per metre at one metre from the camera (the particles' sizes). */
  pixelScale: () => number;
  still: boolean;
  /** Where a cellar can be seen caving in (Baltanás, house.ts), or null: the floor and the ceiling at the
   *  collapse, where the camera stands inside the cellar to watch it, and the ground over it. */
  cellar?: { floor: THREE.Vector3; ceiling: number; eye: THREE.Vector3; above: THREE.Vector3; radius: number } | null;
  /** The camera, for an effect that takes it somewhere (the cellar): fly or cut to a view, darken the
   *  picture (0-1), and back to where it was when the effect began. */
  director?: {
    fly(pos: THREE.Vector3, look: THREE.Vector3, ms: number): Promise<void>;
    cut(pos: THREE.Vector3, look: THREE.Vector3): void;
    fade(v: number): void;
    save(): void;
    home(ms: number): Promise<void>;
  };
}

export interface Weather {
  set(effect: Effect | null): void;
  update(dt: number, now: number): void;
  /** Where an earthquake pushes the camera this frame (house.ts adds it before drawing, then takes it off). */
  shake: THREE.Vector3;
  /** Whether this place can show the effect (plants need wall tops, visitors floors). */
  can(effect: Effect): boolean;
  /** Where the camera should come closer to for the effect to be seen (people, a building on fire, walls
   *  shaking), or null: it is seen from where the camera is. */
  focusFor(effect: Effect): THREE.Vector3 | null;
  dispose(): void;
}

const SKY_BASE = new THREE.Color("#cfe2ee");
const SKY: Partial<Record<Effect, string>> = {
  rain: "#a9b3bc",
  acidrain: "#b3b098",
  flood: "#a9b3bc",
  storm: "#5d6670",
  wind: "#d8d0bb",
  heat: "#f3e3c3",
  sun: "#fff4d6",
  frost: "#e6ecf1",
  damp: "#c3cfd6",
  fire: "#c9b8a4",
  wildfire: "#a8866a",
  smog: "#b4a790",
};
// how close the haze closes in (the fog's start and end, metres)
const FOG: Partial<Record<Effect, [number, number]>> = {
  storm: [60, 420],
  smog: [30, 260],
  damp: [40, 320],
  wildfire: [40, 300],
  frost: [80, 500],
};

/** A soft round dot, for the particles. */
function sprite(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.65)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

/** A cloud of particles, each with its own size (metres), opacity and colour. */
class Cloud {
  readonly pos: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly color: Float32Array;
  readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  constructor(
    readonly n: number,
    map: THREE.Texture,
    additive = false,
  ) {
    this.pos = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.color = new Float32Array(n * 3).fill(1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.color, 3));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 500 } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        uniform float uScale;
        varying float vAlpha; varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.2, -mv.z);
          vAlpha = aAlpha; vColor = aColor;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying float vAlpha; varying vec3 vColor;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }
  set(i: number, x: number, y: number, z: number) {
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
  }
  rgb(i: number, r: number, g: number, b: number) {
    this.color[i * 3] = r;
    this.color[i * 3 + 1] = g;
    this.color[i * 3 + 2] = b;
  }
  commit(scale: number) {
    const geo = this.points.geometry;
    for (const name of ["position", "aSize", "aAlpha", "aColor"]) (geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.material.uniforms.uScale.value = scale;
  }
  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** Streaks moving through the air: rain falling (slanted by the wind), or the wind itself. */
class Streaks {
  readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private readonly local: Float32Array; // x, y, z of each around the centre
  private readonly dir: THREE.Vector3;
  constructor(
    readonly n: number,
    readonly r: number,
    readonly low: number,
    readonly high: number,
    dir: THREE.Vector3,
    readonly speed: number,
    readonly len: number,
    color: string,
    opacity: number,
    private readonly rnd: () => number,
  ) {
    this.dir = dir.clone().normalize();
    this.pos = new Float32Array(n * 6);
    this.local = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.local[i * 3] = (rnd() * 2 - 1) * r;
      this.local[i * 3 + 1] = low + rnd() * (high - low);
      this.local[i * 3 + 2] = (rnd() * 2 - 1) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
  }
  update(dt: number, c: THREE.Vector3) {
    const d = this.dir;
    const span = this.high - this.low;
    for (let i = 0; i < this.n; i++) {
      let x = this.local[i * 3] + d.x * this.speed * dt;
      let y = this.local[i * 3 + 1] + d.y * this.speed * dt;
      let z = this.local[i * 3 + 2] + d.z * this.speed * dt;
      if (y < this.low) {
        y += span;
        x = (this.rnd() * 2 - 1) * this.r;
        z = (this.rnd() * 2 - 1) * this.r;
      }
      if (y > this.high) y -= span;
      if (x > this.r) x -= 2 * this.r;
      if (x < -this.r) x += 2 * this.r;
      if (z > this.r) z -= 2 * this.r;
      if (z < -this.r) z += 2 * this.r;
      this.local[i * 3] = x;
      this.local[i * 3 + 1] = y;
      this.local[i * 3 + 2] = z;
      const o = i * 6;
      this.pos[o] = c.x + x;
      this.pos[o + 1] = c.y + y;
      this.pos[o + 2] = c.z + z;
      this.pos[o + 3] = c.x + x - d.x * this.len;
      this.pos[o + 4] = c.y + y - d.y * this.len;
      this.pos[o + 5] = c.z + z - d.z * this.len;
    }
    (this.lines.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}

export function createWeather(ctx: WeatherContext): Weather {
  const { scene, env } = ctx;
  const dot = sprite();
  const group = new THREE.Group();
  scene.add(group);
  const shake = new THREE.Vector3();
  let effect: Effect | null = null;
  let t = 0; // seconds since the effect started
  let seed = 1;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const R = Math.min(60, Math.max(18, ctx.radius));
  // particles drawn bigger over a bigger view, so they are still seen (dust, snow, mist, smoke)
  const S = Math.max(1, R / 22);
  const wind = new THREE.Vector2(0.8, 0.6).normalize(); // from the south-west, as the sun
  // every part of the current effect, so it can be taken down
  let parts: { update?: (dt: number, c: THREE.Vector3) => void; dispose: () => void }[] = [];
  const targets: Partial<Record<(typeof NUMERIC)[number], number>> = {};
  let cycle: ((t: number) => void) | null = null; // values that come and go (frost and thaw, damp up and down)
  // (called through a function: `cycle` is set inside build, where the type checker cannot follow it)
  const runCycle = (k: number) => cycle?.(k);
  let flashAt = 0;
  let caveShake = 0;
  const skyTo = SKY_BASE.clone();
  const fogTo: [number, number] = [260, 760];
  const fog = scene.fog as THREE.Fog | null;
  const sky = scene.background as THREE.Color;

  // ---------------------------------------------------------------- building blocks
  function streaks(st: Streaks) {
    group.add(st.lines);
    parts.push({ update: (dt, c) => st.update(dt, c), dispose: () => st.dispose() });
  }
  function rain(n: number, speed: number, slant: number, color = "#d6e2ee", opacity = 0.5) {
    // a streak: how far a drop falls in 1/20 s
    streaks(new Streaks(n, R, -8, 22, new THREE.Vector3(wind.x * slant, -1, wind.y * slant), speed, 0.05 * speed, color, opacity, rnd));
  }
  /** A cloud whose particles live `life` seconds and are made again by `born` (local to the centre or
   *  world when `world`). */
  function cloud(
    n: number,
    opts: {
      additive?: boolean;
      world?: boolean;
      born: (i: number, p: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; size: number; alpha: number; rgb: [number, number, number] }) => void;
      grow?: number; // size added over its life (times its size)
      fadeIn?: number; // share of its life to fade in over
      wobble?: number;
    },
  ) {
    const c = new Cloud(n, dot, opts.additive);
    group.add(c.points);
    const st = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, age: 0, size: 1, alpha: 1, rgb: [1, 1, 1] as [number, number, number] }));
    st.forEach((p, i) => {
      opts.born(i, p);
      p.age = rnd() * p.life; // spread over their lives from the start, where they would be by then
      p.x += p.vx * p.age;
      p.y += p.vy * p.age;
      p.z += p.vz * p.age;
    });
    const update = (dt: number, centre: THREE.Vector3) => {
      for (let i = 0; i < n; i++) {
        const p = st[i];
        p.age += dt;
        if (p.age > p.life) {
          opts.born(i, p);
          p.age = 0;
        }
        const w = opts.wobble ? Math.sin((p.age + i) * 2.1) * opts.wobble : 0;
        p.x += (p.vx + w) * dt;
        p.y += p.vy * dt;
        p.z += (p.vz + w * 0.6) * dt;
        const k = p.age / p.life;
        const fin = opts.fadeIn ? Math.min(1, k / opts.fadeIn) : 1;
        const fout = Math.min(1, (1 - k) / 0.3);
        if (opts.world) c.set(i, p.x, p.y, p.z);
        else c.set(i, centre.x + p.x, centre.y + p.y, centre.z + p.z);
        c.size[i] = p.size * (1 + (opts.grow ?? 0) * k);
        c.alpha[i] = p.alpha * fin * fout;
        c.rgb(i, p.rgb[0], p.rgb[1], p.rgb[2]);
      }
      c.commit(ctx.pixelScale());
    };
    parts.push({ update, dispose: () => c.dispose() });
  }
  /** Within the square around the centre, wrapping round: for dust, snow and soot that drift past. */
  const around = () => [(rnd() * 2 - 1) * R, (rnd() * 2 - 1) * R] as const;
  const groundAt = (x: number, z: number, c: THREE.Vector3) => ctx.surface(c.x + x, c.z + z) - c.y;

  function snow(n: number) {
    cloud(n, {
      born: (_i, p) => {
        const [x, z] = around();
        Object.assign(p, { x, z, y: 22, vx: wind.x * 0.4, vy: -(0.7 + rnd() * 0.7), vz: wind.y * 0.4, life: 26 + rnd() * 6, size: (0.1 + rnd() * 0.08) * S, alpha: 0.95, rgb: [1, 1, 1] });
      },
      wobble: 0.35,
    });
  }
  function dust(n: number, speed: number, rgb: [number, number, number], size: number, alpha: number, height = 5) {
    cloud(n, {
      born: (_i, p) => {
        const [x, z] = around();
        const c = ctx.target();
        const g = groundAt(x, z, c);
        Object.assign(p, {
          x: x - wind.x * R * 0.6,
          z: z - wind.y * R * 0.6,
          y: g + rnd() * height,
          vx: wind.x * speed * (0.7 + rnd() * 0.6),
          vy: (rnd() - 0.4) * 0.4,
          vz: wind.y * speed * (0.7 + rnd() * 0.6),
          life: (R * 1.2) / speed,
          size: size * S * (0.6 + rnd() * 0.8),
          alpha,
          rgb,
        });
      },
      fadeIn: 0.2,
      wobble: 0.6,
    });
  }
  function mist(n: number) {
    cloud(n, {
      born: (_i, p) => {
        const [x, z] = around();
        const c = ctx.target();
        Object.assign(p, {
          x: x * 0.8,
          z: z * 0.8,
          y: ctx.base - c.y + rnd() * 1.6,
          vx: (rnd() - 0.5) * 0.4,
          vy: 0.03,
          vz: (rnd() - 0.5) * 0.4,
          life: 12 + rnd() * 8,
          size: (4 + rnd() * 5) * S,
          alpha: 0.24,
          rgb: [0.92, 0.95, 0.97],
        });
      },
      fadeIn: 0.25,
      grow: 0.3,
    });
  }
  /** Flames and smoke rising from `sources` (world points), `big` for a forest fire. */
  function fire(sources: THREE.Vector3[], big: boolean) {
    const spread = big ? 3 : 1.8;
    cloud(big ? 900 : 450, {
      additive: true,
      world: true,
      born: (_i, p) => {
        const s = sources[Math.floor(rnd() * sources.length)];
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * spread;
        const hot = rnd();
        Object.assign(p, {
          x: s.x + Math.cos(a) * d,
          y: s.y + 0.1,
          z: s.z + Math.sin(a) * d,
          vx: wind.x * 0.4,
          vy: 1.8 + rnd() * (big ? 2.4 : 1.6),
          vz: wind.y * 0.4,
          life: 0.5 + rnd() * 0.7,
          size: (big ? 2 : 1.6) * (0.5 + rnd() * 0.6),
          alpha: 0.85,
          rgb: [1, 0.55 + hot * 0.4, 0.12 + hot * 0.25],
        });
      },
      grow: -0.6,
      wobble: 0.5,
    });
    cloud(big ? 260 : 120, {
      world: true,
      born: (_i, p) => {
        const s = sources[Math.floor(rnd() * sources.length)];
        const grey = 0.2 + rnd() * 0.25;
        Object.assign(p, {
          x: s.x + (rnd() - 0.5) * spread,
          y: s.y + 1.5,
          z: s.z + (rnd() - 0.5) * spread,
          vx: wind.x * (0.8 + rnd()),
          vy: 1.2 + rnd() * 1.4,
          vz: wind.y * (0.8 + rnd()),
          life: 6 + rnd() * 5,
          size: big ? 3 : 1.8,
          alpha: 0.42,
          rgb: [grey, grey, grey * 0.95],
        });
      },
      fadeIn: 0.1,
      grow: 3,
      wobble: 0.3,
    });
  }

  // ---------------------------------------------------------------- moving things: stones, people, water
  function stones(rolling: boolean) {
    const n = rolling ? 40 : 60;
    const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: rolling ? "#6e5d4b" : "#8d8274" }), n);
    mesh.frustumCulled = false;
    group.add(mesh);
    const near = ctx.tops.filter((p) => p.distanceTo(ctx.target()) < R);
    const st = Array.from({ length: n }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0.1, rest: true, spin: 0 }));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const born = (s: (typeof st)[number]) => {
      const c = ctx.target();
      if (!rolling && near.length) {
        s.p.copy(near[Math.floor(rnd() * near.length)]).add(new THREE.Vector3((rnd() - 0.5) * 0.4, 0.1, (rnd() - 0.5) * 0.4));
        s.v.set((rnd() - 0.5) * 1.2, rnd() * 1.5, (rnd() - 0.5) * 1.2);
      } else {
        const [x, z] = around();
        s.p.set(c.x + x * 0.45, 0, c.z + z * 0.45);
        s.p.y = ctx.surface(s.p.x, s.p.z) + 0.2;
        s.v.set(0, 0, 0);
      }
      s.r = rolling ? (0.35 + rnd() * 0.5) * Math.min(2, S) : 0.12 + rnd() * 0.2;
      s.rest = false;
    };
    st.forEach(born);
    let wave = 0;
    const update = (dt: number) => {
      wave += dt;
      for (const s of st) {
        if (s.rest) {
          if (rolling ? rnd() < dt * 0.4 : wave % 5 < dt) born(s);
          continue;
        }
        if (rolling) {
          // down the slope: towards the lower side, faster where it is steep
          const e = 0.6;
          const gx = ctx.surface(s.p.x + e, s.p.z) - ctx.surface(s.p.x - e, s.p.z);
          const gz = ctx.surface(s.p.x, s.p.z + e) - ctx.surface(s.p.x, s.p.z - e);
          const steep = Math.hypot(gx, gz) / (2 * e);
          s.v.x += (-gx / (2 * e)) * 9 * dt;
          s.v.z += (-gz / (2 * e)) * 9 * dt;
          s.v.multiplyScalar(steep < 0.08 ? 0.9 : 0.995);
          s.p.addScaledVector(s.v, dt);
          s.p.y = ctx.surface(s.p.x, s.p.z) + s.r;
          if (s.v.length() < 0.05 && steep < 0.08) s.rest = true;
        } else {
          s.v.y -= 9.8 * dt;
          s.p.addScaledVector(s.v, dt);
          const floor = ctx.surface(s.p.x, s.p.z) + s.r;
          if (s.p.y < floor) {
            s.p.y = floor;
            s.v.multiplyScalar(0.3);
            s.v.y = Math.abs(s.v.y) > 0.6 ? Math.abs(s.v.y) * 0.4 : 0;
            if (s.v.length() < 0.2) s.rest = true;
          }
        }
        s.spin += dt * (rolling ? s.v.length() / s.r : 3);
      }
      st.forEach((s, i) => {
        q.setFromAxisAngle(new THREE.Vector3(1, 0.3, 0.2).normalize(), s.spin);
        mesh.setMatrixAt(i, m.compose(s.p, q, new THREE.Vector3(s.r, s.r, s.r)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    parts.push({
      update,
      dispose: () => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      },
    });
  }
  function people() {
    const n = 26;
    const c = ctx.target();
    // within 15 m of the floor the camera looks at (the camera comes close for them: focusFor)
    let spots = ctx.flats.filter((p) => p.distanceTo(c) < 15);
    if (spots.length < 12) spots = ctx.flats.filter((p) => p.distanceTo(c) < R * 0.9);
    if (spots.length < 6) return;
    const body = new THREE.CylinderGeometry(0.17, 0.22, 1.35, 8).translate(0, 0.68, 0);
    const head = new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.55, 0);
    // two parts as one mesh, so every person is one instance
    const geo = mergeTwo(body, head);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: "#ffffff" }), n);
    mesh.frustumCulled = false;
    const palette = ["#b8452d", "#2f5d8a", "#e0b23a", "#3f7a4a", "#7a4f8c", "#d9d4c8", "#262626", "#c66b8a"];
    const st = Array.from({ length: n }, (_v, i) => {
      mesh.setColorAt(i, new THREE.Color(palette[i % palette.length]));
      const at = spots[Math.floor(rnd() * spots.length)].clone();
      return { at, to: at.clone(), speed: 0.9 + rnd() * 0.6, wait: rnd() * 3, step: rnd() * 10 };
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const pick = (s: (typeof st)[number]) => {
      // somewhere near, with nothing of the model in between (people go round walls, not through them)
      for (let k = 0; k < 6; k++) {
        const next = spots[Math.floor(rnd() * spots.length)];
        if (next.distanceTo(s.at) > 9 || next.distanceTo(s.at) < 1.5) continue;
        if (!ctx.blocked(s.at.clone().setY(s.at.y + 1), next.clone().setY(next.y + 1))) {
          s.to.copy(next);
          return;
        }
      }
      s.wait = 1 + rnd() * 3;
    };
    const update = (dt: number) => {
      st.forEach((s, i) => {
        if (s.wait > 0) {
          s.wait -= dt;
          if (s.wait <= 0) pick(s);
        } else {
          const d = s.to.clone().sub(s.at);
          d.y = 0;
          const len = d.length();
          if (len < 0.2) {
            s.wait = 0.5 + rnd() * 4;
          } else {
            s.at.addScaledVector(d.normalize(), Math.min(len, s.speed * dt));
            s.at.y = ctx.surface(s.at.x, s.at.z);
            s.step += dt * 8;
            q.setFromAxisAngle(up, Math.atan2(d.x, d.z));
          }
        }
        const bob = s.wait > 0 ? 0 : Math.abs(Math.sin(s.step)) * 0.04;
        mesh.setMatrixAt(i, m.compose(s.at.clone().setY(s.at.y + bob), q, one));
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    st.forEach(pick);
    parts.push({
      update,
      dispose: () => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        body.dispose();
        head.dispose();
      },
    });
  }
  function flood() {
    const c = ctx.target();
    let low = Infinity;
    for (let a = 0; a < 16; a++) {
      for (const d of [0, 4, 9]) low = Math.min(low, ctx.surface(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d));
    }
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(R * 1.3, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#5b8299", transparent: true, opacity: 0.62, depthWrite: false }),
    );
    water.renderOrder = 2;
    water.position.set(c.x, low - 0.3, c.z);
    group.add(water);
    parts.push({
      update: () => {
        // the water rises over 10 s to 1.2 m above the lowest floor near, stays, goes down, comes again
        const k = t % 20;
        const level = k < 10 ? k / 10 : k < 15 ? 1 : 1 - (k - 15) / 5;
        water.position.y = low - 0.3 + 1.5 * (ctx.still ? 0.8 : level);
      },
      dispose: () => {
        water.geometry.dispose();
        (water.material as THREE.Material).dispose();
      },
    });
  }
  function plantsGrow() {
    // plants root and grow over the walls; on a loop, they are cut back and come again
    parts.push({
      update: () => {
        const k = ctx.still ? 9 : t % 14;
        const f = k < 9 ? k / 9 : k < 12 ? 1 : 1 - (k - 12) / 2;
        ctx.plants.show(Math.min(1, f * 1.4), 0.4 + 2.2 * f);
      },
      dispose: () => ctx.plants.restore(),
    });
  }

  // ---------------------------------------------------------------- a cellar caving in
  /** Pieces of the cellar's roof: they come away from the ceiling one after another (from `start` s),
   *  fall, and come to rest in a heap on the floor. Plain earth and stone, lit as the cellar is. */
  function debris(c: NonNullable<WeatherContext["cellar"]>, start: number) {
    const n = 150;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uInCellar: env.inCellar });
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vRock;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvRock = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vRock;\nuniform float uInCellar;")
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          vec3 nR = normalize(cross(dFdx(vRock), dFdy(vRock)));
          vec3 toCamR = cameraPosition - vRock;
          float dR = length(toCamR);
          if (dot(nR, toCamR) < 0.0) nR = -nR;
          float lampR = (0.25 + 0.75 * max(dot(nR, toCamR / max(dR, 0.001)), 0.0)) / (1.0 + 0.035 * dR * dR);
          float dayR = 0.55 + 0.45 * max(dot(nR, normalize(vec3(-0.4, 0.8, 0.3))), 0.0);
          diffuseColor.rgb *= mix(dayR, clamp(lampR * 1.7 + 0.05, 0.0, 1.25), uInCellar);`,
        );
    };
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.frustumCulled = false;
    const tones = ["#6f5a44", "#857158", "#9c8b70", "#5d4b39", "#a99a80"];
    const st = Array.from({ length: n }, (_v, i) => {
      mesh.setColorAt(i, new THREE.Color(tones[i % tones.length]));
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * c.radius * 0.75;
      const big = i < 16; // slabs of the vault, the rest smaller pieces
      const r = big ? 0.35 + rnd() * 0.3 : 0.08 + rnd() * 0.2;
      return {
        p: new THREE.Vector3(c.floor.x + Math.cos(a) * d, c.ceiling - r, c.floor.z + Math.sin(a) * d),
        v: new THREE.Vector3((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4),
        r,
        flat: big ? 0.45 : 0.8 + rnd() * 0.3,
        // when it comes away (with less motion: already, so the still picture shows them lying there)
        at: ctx.still ? -1 : start + (big ? 0.3 + rnd() * 1.6 : rnd() * 2.8),
        rest: false,
        spin: rnd() * 6,
        axis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
      };
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    let landed = 0;
    const update = (dt: number) => {
      st.forEach((s, i) => {
        if (t < s.at) {
          // still part of the roof: hidden above it
          mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
          return;
        }
        if (!s.rest) {
          s.v.y -= 9.8 * dt;
          s.p.addScaledVector(s.v, dt);
          s.spin += dt * 4;
          // they land on the mound the fallen roof makes (house.ts, CAVE_BEGIN: 0.9 m high in the middle),
          // a little higher as more of them pile up
          const dMid = Math.min(1, Math.hypot(s.p.x - c.floor.x, s.p.z - c.floor.z) / c.radius);
          const mound = 0.9 * env.cave.value * (1 - dMid * dMid * (3 - 2 * dMid));
          const heap = c.floor.y + 0.2 + mound + (1 - dMid) * Math.min(0.5, landed * 0.006);
          if (s.p.y - s.r * s.flat < heap) {
            s.p.y = heap + s.r * s.flat;
            if (Math.abs(s.v.y) > 1.2) {
              s.v.y = Math.abs(s.v.y) * 0.25;
              s.v.x *= 0.5;
              s.v.z *= 0.5;
            } else {
              s.rest = true;
              landed++;
            }
          }
        }
        q.setFromAxisAngle(s.axis, s.spin);
        sc.set(s.r, s.r * s.flat, s.r);
        mesh.setMatrixAt(i, m.compose(s.p, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    parts.push({
      update,
      dispose: () => {
        geo.dispose();
        mat.dispose();
      },
    });
  }
  /** "Cellars that cave in": the camera goes down into a cellar; there, dust trickles from the ceiling,
   *  then pieces of the roof come away, fall and lie in a heap on the floor, the camera at the bottom
   *  watching; then back outside, where the ground over it has sunk into a hollow; then back to where the
   *  camera was. Which stretch caves in, and how much, is an illustration (README, "See it happen"). */
  function caveIn() {
    const c = ctx.cellar;
    const dir = ctx.director;
    if (!c || !dir) return;
    env.caveC.value.copy(c.floor);
    env.caveR.value = c.radius;
    const lookUp = new THREE.Vector3(c.floor.x, c.floor.y + (c.ceiling - c.floor.y) * 0.7, c.floor.z);
    const lookFloor = new THREE.Vector3(c.floor.x, c.floor.y + 0.4, c.floor.z);
    // from outside: the ground over the collapse, from the side the camera is already on
    const out = ctx.target().clone().sub(c.above).setY(0);
    if (out.lengthSq() < 1) out.set(-1, 0, 1);
    out.normalize();
    const overPos = c.above.clone().addScaledVector(out, 9).setY(c.above.y + 13);
    const afterPos = c.above.clone().addScaledVector(out, 7).setY(c.above.y + 8);
    const COLLAPSE = 6.2; // seconds in: the roof comes down
    debris(c, COLLAPSE);
    // dust: trickling from the ceiling before, a cloud filling the cellar after
    cloud(260, {
      world: true,
      born: (_i, p) => {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * c.radius;
        const after = t > COLLAPSE;
        Object.assign(p, {
          x: c.floor.x + Math.cos(a) * d,
          y: after ? c.floor.y + rnd() * (c.ceiling - c.floor.y) : c.ceiling - 0.05,
          z: c.floor.z + Math.sin(a) * d,
          vx: (rnd() - 0.5) * (after ? 0.6 : 0.05),
          vy: after ? (rnd() - 0.3) * 0.3 : -(0.4 + rnd() * 0.6),
          vz: (rnd() - 0.5) * (after ? 0.6 : 0.05),
          life: after ? 4 + rnd() * 3 : 1.2 + rnd(),
          size: after ? 0.35 + rnd() * 0.5 : 0.03 + rnd() * 0.04,
          alpha: t < 3.5 ? 0 : after ? 0.13 : 0.8,
          rgb: after ? [0.42, 0.37, 0.3] : [0.62, 0.55, 0.45],
        });
      },
      grow: 1.2,
      fadeIn: 0.15,
      wobble: 0.15,
    });
    const fired = new Set<string>();
    const once = (k: number, name: string, at: number, fn: () => void) => {
      if (k >= at && !fired.has(name)) {
        fired.add(name);
        fn();
      }
    };
    dir.save();
    if (ctx.still) {
      // a still picture: at the bottom of the cellar, the roof already down
      dir.cut(c.eye, lookFloor);
      env.inCellar.value = 1;
      env.cave.value = 1;
      env.hollow.value = 1;
      cycle = () => {};
      return;
    }
    cycle = (k) => {
      once(k, "over", 0, () => void dir.fly(overPos, c.above, 2200));
      // down into the cellar: the picture goes dark, the camera is inside, the lamp on
      once(k, "dark", 2.2, () => dir.fade(1));
      once(k, "inside", 2.65, () => {
        dir.cut(c.eye, lookUp);
        env.inCellar.value = 1;
      });
      once(k, "light", 2.75, () => dir.fade(0));
      // the roof comes down; the camera looks after the pieces to the floor
      env.cave.value = k < COLLAPSE ? 0 : Math.min(1, (k - COLLAPSE) / 2.4);
      caveShake = k > COLLAPSE - 1.2 && k < COLLAPSE + 2.5 ? (k < COLLAPSE ? 0.008 : 0.05 * Math.max(0, 1 - (k - COLLAPSE) / 2.5)) : 0;
      once(k, "watch", COLLAPSE + 1.6, () => void dir.fly(c.eye, lookFloor, 2000));
      // back outside: the ground over it sunk into a hollow
      once(k, "dark2", 12, () => dir.fade(1));
      once(k, "outside", 12.45, () => {
        env.inCellar.value = 0;
        env.hollow.value = 1;
        dir.cut(afterPos, c.above);
      });
      once(k, "light2", 12.55, () => dir.fade(0));
      once(k, "home", 16.5, () => void dir.home(2200));
    };
  }

  // ---------------------------------------------------------------- the effects
  function build(e: Effect) {
    const c = ctx.target();
    switch (e) {
      case "rain":
        rain(5000, 11, 0.12);
        targets.wet = 0.75;
        targets.dim = 0.12;
        break;
      case "acidrain":
        rain(4500, 10, 0.1, "#e3e2c8");
        targets.wet = 0.6;
        targets.soot = 0.45;
        targets.dim = 0.12;
        break;
      case "flood":
        rain(4000, 11, 0.12);
        flood();
        targets.wet = 0.8;
        targets.dim = 0.15;
        break;
      case "storm":
        rain(7000, 16, 0.55, "#c8d3de", 0.55);
        dust(500, 10, [0.85, 0.82, 0.75], 0.05, 0.6, 3);
        targets.wet = 0.85;
        targets.dim = 0.38;
        ctx.plants.sway.value = 0.6;
        break;
      case "wind":
        dust(3200, 9, [0.86, 0.79, 0.64], 0.06, 0.75, 4);
        dust(420, 10, [0.84, 0.76, 0.6], 1.1, 0.16, 3); // sand blown along in clouds
        // the wind itself: long streaks rushing past, seen however far away the camera is
        streaks(new Streaks(Math.round(160 * S), R, -2, 14, new THREE.Vector3(wind.x, 0.03, wind.y), 14, 3 + 2 * S, "#ffffff", 0.45, rnd));
        targets.soot = 0.05;
        ctx.plants.sway.value = 0.45;
        break;
      case "heat":
        cloud(320, {
          born: (_i, p) => {
            const [x, z] = around();
            Object.assign(p, { x, z, y: groundAt(x, z, ctx.target()) + rnd() * 0.5, vx: 0, vy: 0.5 + rnd() * 0.4, vz: 0, life: 3 + rnd() * 2, size: 0.5 + rnd() * 0.5, alpha: 0.12, rgb: [1, 0.97, 0.9] });
          },
          fadeIn: 0.3,
          wobble: 0.3,
        });
        targets.heat = 0.8;
        break;
      case "sun":
        targets.heat = 0.25;
        cycle = (k) => {
          env.fade.value = ctx.still ? 0.55 : Math.min(0.6, k / 14); // colours fading in the sunlight
        };
        break;
      case "frost":
        snow(3600);
        cycle = (k) => {
          // freezing, then thawing (the water in the cracks freezes again and again)
          const s = ctx.still ? 5 : k % 16;
          env.frost.value = s < 7 ? s / 7 : s < 10 ? 1 : Math.max(0, 1 - (s - 10) / 4);
          env.wet.value = s < 10 ? 0 : s < 14 ? (s - 10) / 4 * 0.6 : 0.6 * (1 - (s - 14) / 2);
        };
        targets.dim = 0.05;
        break;
      case "quake":
      case "walls":
        // stones and dust coming down from the wall tops (an earthquake also shakes the camera: update)
        stones(false);
        cloud(e === "quake" ? 500 : 250, {
          born: (_i, p) => {
            const top = ctx.tops.length ? ctx.tops[Math.floor(rnd() * ctx.tops.length)] : c;
            const cc = ctx.target();
            Object.assign(p, { x: top.x - cc.x + (rnd() - 0.5), y: top.y - cc.y, z: top.z - cc.z + (rnd() - 0.5), vx: (rnd() - 0.5) * 0.3, vy: -(0.6 + rnd()), vz: (rnd() - 0.5) * 0.3, life: 2.5 + rnd() * 2, size: 0.5 + rnd() * 0.7, alpha: e === "quake" ? 0.55 : 0.4, rgb: [0.78, 0.72, 0.64] });
          },
          grow: 2.5,
          fadeIn: 0.1,
        });
        break;
      case "creep": {
        // the ground on the slope sliding slowly downhill below a tear across it, the walls on it tilting:
        // 50 years in 12 s, at an assumed 1 cm a year (0.5 m in all); then again
        const g = 2;
        const dir = new THREE.Vector2(-(ctx.surface(c.x + g, c.z) - ctx.surface(c.x - g, c.z)), -(ctx.surface(c.x, c.z + g) - ctx.surface(c.x, c.z - g)));
        if (dir.lengthSq() < 1e-6) dir.set(1, 0);
        env.geoDir.value.copy(dir.normalize());
        env.geoCentre.value.set(c.x, c.z);
        env.geoR.value = Math.min(R, 30);
        cycle = (k) => {
          env.creep.value = 0.5 * Math.min(1, (ctx.still ? 12 : k % 15) / 12);
        };
        break;
      }
      case "sink":
        // the ground settling under the buildings in a dish, the walls leaning in: 50 years in 12 s, at an
        // assumed 8 mm a year (0.4 m at the middle); then again
        env.geoCentre.value.set(c.x, c.z);
        env.geoR.value = Math.min(25, Math.max(8, R * 0.5));
        cycle = (k) => {
          env.sink.value = 0.4 * Math.min(1, (ctx.still ? 12 : k % 15) / 12);
        };
        break;
      case "slide":
        stones(true);
        dust(600, 1.2, [0.62, 0.55, 0.45], 2.4, 0.32, 2);
        break;
      case "damp":
        mist(160);
        cycle = (k) => {
          // the damp rising in the walls and falling again, as the air gets wetter and drier
          env.dampLow.value = ctx.still ? 0.8 : 0.45 + 0.4 * Math.sin(k * 0.8);
        };
        targets.wet = 0.18;
        break;
      case "fire":
      case "wildfire": {
        const big = e === "wildfire";
        const sources: THREE.Vector3[] = [];
        if (big) {
          for (let k = 0; k < 9; k++) {
            const a = (k / 9) * Math.PI * 2 + rnd() * 0.4;
            const d = R * (0.65 + rnd() * 0.3);
            const x = c.x + Math.cos(a) * d;
            const z = c.z + Math.sin(a) * d;
            sources.push(new THREE.Vector3(x, ctx.surface(x, z), z));
          }
        } else {
          // a building on fire: flames out of its roof
          for (let k = 0; k < 3; k++) {
            const x = c.x + (rnd() - 0.5) * 4;
            const z = c.z + (rnd() - 0.5) * 4;
            sources.push(new THREE.Vector3(x, ctx.topAt(x, z), z));
          }
        }
        fire(sources, big);
        targets.heat = big ? 0.35 : 0.2;
        targets.soot = big ? 0.25 : 0.15;
        targets.dim = big ? 0.15 : 0.05;
        break;
      }
      case "smog":
        cloud(1600, {
          born: (_i, p) => {
            const [x, z] = around();
            Object.assign(p, { x, z, y: groundAt(x, z, ctx.target()) + rnd() * 14, vx: wind.x * 0.6, vy: (rnd() - 0.5) * 0.1, vz: wind.y * 0.6, life: 20 + rnd() * 10, size: (0.07 + rnd() * 0.07) * S, alpha: 0.7, rgb: [0.2, 0.18, 0.15] });
          },
          fadeIn: 0.1,
          wobble: 0.2,
        });
        cycle = (k) => {
          env.soot.value = ctx.still ? 0.5 : Math.min(0.55, k / 16);
        };
        targets.dim = 0.08;
        break;
      case "plants":
        plantsGrow();
        ctx.plants.sway.value = 0.15;
        break;
      case "visitors":
        people();
        break;
      case "cellar":
        caveIn();
        break;
    }
  }

  const ENV_KEYS = NUMERIC;
  return {
    shake,
    focusFor(e) {
      const c = ctx.target();
      if (e === "visitors") {
        // the middle of the floors near: where people walk
        const spots = ctx.flats.filter((p) => p.distanceTo(c) < R * 0.9);
        if (!spots.length) return null;
        const m = spots.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / spots.length);
        return spots.reduce((best, p) => (p.distanceTo(m) < best.distanceTo(m) ? p : best)).clone();
      }
      if (e === "fire") return new THREE.Vector3(c.x, ctx.topAt(c.x, c.z), c.z);
      if ((e === "quake" || e === "walls") && ctx.tops.length) {
        const top = ctx.tops.reduce((best, p) => (p.distanceTo(c) < best.distanceTo(c) ? p : best));
        return top.clone();
      }
      return null;
    },
    can(e) {
      if (e === "plants") return ctx.plants.count > 0;
      if (e === "visitors") return ctx.flats.filter((p) => p.distanceTo(ctx.target()) < R * 0.9).length >= 6;
      if (e === "cellar") return !!ctx.cellar && !!ctx.director;
      return true;
    },
    set(e) {
      for (const p of parts) p.dispose();
      parts = [];
      group.clear();
      for (const k of ENV_KEYS) delete targets[k];
      cycle = null;
      ctx.plants.sway.value = 0;
      ctx.plants.restore();
      shake.set(0, 0, 0);
      env.cave.value = env.hollow.value = env.inCellar.value = 0;
      ctx.overlay.style.setProperty("--dark", "0");
      effect = e;
      t = 0;
      flashAt = 0;
      seed = 7;
      skyTo.copy(e && SKY[e] ? new THREE.Color(SKY[e]) : SKY_BASE);
      const f = (e && FOG[e]) || [260, 760];
      fogTo[0] = f[0];
      fogTo[1] = f[1];
      ctx.overlay.dataset.fx = e ?? "";
      ctx.overlay.style.setProperty("--flash", "0");
      if (e) build(e);
      if (ctx.still) {
        // a still picture: the weather as it is a few seconds in, all at once
        for (const k of ENV_KEYS) env[k].value = targets[k] ?? 0;
        sky.copy(skyTo);
        if (fog) [fog.near, fog.far] = fogTo;
        const c = ctx.target();
        for (let i = 0; i < 6; i++) for (const p of parts) p.update?.(0.5, c);
        runCycle(9);
      }
    },
    update(dt, now) {
      if (ctx.still) return;
      t += dt;
      // the light and the haze move towards the effect's over a second or two
      const k = 1 - Math.exp(-dt * 1.5);
      for (const key of ENV_KEYS) if (key !== "flash") env[key].value += ((targets[key] ?? 0) - env[key].value) * k;
      sky.lerp(skyTo, k);
      if (fog) {
        fog.near += (fogTo[0] - fog.near) * k;
        fog.far += (fogTo[1] - fog.far) * k;
      }
      runCycle(t);
      // a storm's lightning: a flash every 4-8 seconds (never more than one a second)
      if (effect === "storm") {
        if (!flashAt) flashAt = now + 2500;
        let fl = 0;
        if (now >= flashAt) {
          const k = (now - flashAt) / 180;
          if (k < 1) fl = 1 - k;
          else flashAt = now + 4000 + rnd() * 4000;
        }
        env.flash.value = fl * 0.9;
        ctx.overlay.style.setProperty("--flash", String(fl * 0.55));
      } else {
        env.flash.value = 0;
      }
      // an earthquake: the ground (and the camera on it) shakes for 2.5 s in every 5
      if (effect === "cellar") {
        const a = caveShake;
        shake.set(Math.sin(now / 29) * a, Math.sin(now / 19) * a * 0.7, Math.cos(now / 23) * a);
      } else if (effect === "quake" || effect === "slide") {
        const burst = t % 5 < 2.5 ? Math.sin((Math.PI * (t % 5)) / 2.5) : 0;
        const a = (effect === "quake" ? 0.14 : 0.04) * burst;
        shake.set(Math.sin(now / 37) * a, Math.sin(now / 23) * a * 0.6, Math.cos(now / 31) * a);
      } else {
        shake.set(0, 0, 0);
      }
      const c = ctx.target();
      for (const p of parts) p.update?.(Math.min(dt, 0.1), c);
    },
    dispose() {
      for (const p of parts) p.dispose();
      parts = [];
      scene.remove(group);
      dot.dispose();
    },
  };
}

/** Two geometries as one (position, normal), for a person: a body and a head. */
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const parts = [a.toNonIndexed(), b.toNonIndexed()];
  const geo = new THREE.BufferGeometry();
  for (const name of ["position", "normal"]) {
    const arrays = parts.map((p) => p.getAttribute(name).array as Float32Array);
    const all = new Float32Array(arrays.reduce((s, x) => s + x.length, 0));
    let o = 0;
    for (const x of arrays) {
      all.set(x, o);
      o += x.length;
    }
    geo.setAttribute(name, new THREE.BufferAttribute(all, 3));
  }
  parts.forEach((p) => p.dispose());
  return geo;
}
