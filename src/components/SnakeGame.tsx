import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Trophy,
  RefreshCw,
  Play,
  Pause,
  Zap,
  AlertTriangle,
  Heart,
  Snowflake,
  Volume2,
  VolumeX,
} from "lucide-react";

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash >>> 0;
};

class PRNG {
  private a: number;
  constructor(seed: number) {
    this.a = seed;
  }
  next() {
    let t = (this.a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  getState() {
    return this.a;
  }
}

// --- Constants ---
const GRID_COLS = 32;
const GRID_ROWS = 24;
const INITIAL_DIRECTION = { x: 0, y: -1 };
const MIN_SPEED = 40;
const OVERCLOCK_DURATION = 5000;

// --- Types ---
type Point = { x: number; y: number };
type GameState = "START" | "BOOTING" | "PLAYING" | "PAUSED" | "GAME_OVER";
type DifficultyLevel = "EASY" | "NORMAL" | "HARD";
type GameMode = "CLASSIC" | "SIMULATION";
type PowerupType = "OVERCLOCK" | "CRYO" | "HEART";
type ThemeKey = "NEON" | "CRT" | "FOREST" | "CYBERPUNK" | "BLOOD" | "ARCTIC";

type EatVFX = {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  isSpecial: boolean;
  dx: number;
  dy: number;
};

interface PowerupNode extends Point {
  type: PowerupType;
}

const INITIAL_SNAKE = [
  { x: Math.floor(GRID_COLS / 2), y: Math.floor(GRID_ROWS / 2) },
  { x: Math.floor(GRID_COLS / 2) - 1, y: Math.floor(GRID_ROWS / 2) },
  { x: Math.floor(GRID_COLS / 2) - 2, y: Math.floor(GRID_ROWS / 2) },
];

interface SavedState {
  snake: Point[];
  food: Point;
  obstacles: Point[];
  powerups: PowerupNode[];
  score: number;
  difficulty: DifficultyLevel;
  speed: number;
  gameMode: GameMode;
  rngState?: number;
  lives: number;
  theme?: ThemeKey;
  direction?: Point;
}

interface ThemeConfig {
  name: string;
  bgOuter: string;
  bgInner: string;
  gridBase: string; // r, g, b
  uiText: string;
  snakeBase: string; // r, g, b
  particleBase: string;
  hudMuted: string;
  gridBorder: string;
}

const THEMES: Record<ThemeKey, ThemeConfig> = {
  NEON: {
    name: "Neon Stream",
    bgOuter: "#112222",
    bgInner: "#000000",
    gridBase: "17, 17, 17",
    uiText: "#00FFFF",
    snakeBase: "0, 255, 255",
    particleBase: "#00FFFF",
    hudMuted: "#333333",
    gridBorder: "#222222",
  },
  CRT: {
    name: "Retro CRT",
    bgOuter: "#050a05",
    bgInner: "#000000",
    gridBase: "10, 20, 10",
    uiText: "#39FF14",
    snakeBase: "57, 255, 20",
    particleBase: "#39FF14",
    hudMuted: "#1a331a",
    gridBorder: "#1a401a",
  },
  FOREST: {
    name: "Forest Digital",
    bgOuter: "#0a1a0f",
    bgInner: "#020a05",
    gridBase: "26, 41, 31",
    uiText: "#32CD32",
    snakeBase: "50, 205, 50",
    particleBase: "#32CD32",
    hudMuted: "#1a331a",
    gridBorder: "#1a3a1a",
  },
  CYBERPUNK: {
    name: "Cyberpunk",
    bgOuter: "#1c0024",
    bgInner: "#0a000d",
    gridBase: "42, 0, 51",
    uiText: "#FF00FF",
    snakeBase: "0, 255, 255",
    particleBase: "#00FFFF",
    hudMuted: "#400040",
    gridBorder: "#4a004a",
  },
  BLOOD: {
    name: "Blood Moon",
    bgOuter: "#1a0000",
    bgInner: "#000000",
    gridBase: "28, 5, 5",
    uiText: "#FF0000",
    snakeBase: "255, 50, 0",
    particleBase: "#FF3200",
    hudMuted: "#4a0000",
    gridBorder: "#3a0000",
  },
  ARCTIC: {
    name: "Arctic Stream",
    bgOuter: "#001026",
    bgInner: "#000511",
    gridBase: "0, 26, 51",
    uiText: "#88CCFF",
    snakeBase: "255, 255, 255",
    particleBase: "#FFFFFF",
    hudMuted: "#003366",
    gridBorder: "#002b4d",
  },
};

// --- Audio Engine ---
let audioCtx: AudioContext | null = null;

const getAudioContext = () => {
  if (!audioCtx) {
    audioCtx = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
  }
  return audioCtx;
};

export const initAudioEngine = () => {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    ctx.resume();
  }
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.001);
};

const playTone = (
  freq: number,
  type: OscillatorType,
  duration: number,
  volume: number = 0.1,
) => {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
};

const sounds = {
  click: () => playTone(800, "sine", 0.05, 0.05),
  startGame: () => {
    // quick, rising retro arpeggio / power-up
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(300, ctx.currentTime);
    osc.frequency.setValueAtTime(400, ctx.currentTime + 0.1);
    osc.frequency.setValueAtTime(500, ctx.currentTime + 0.2);
    osc.frequency.setValueAtTime(600, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  },
  pauseGame: () => {
    // soft, mid-range double-beep
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const gain2 = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, ctx.currentTime);

    // Create an envelope that pulses twice
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0, ctx.currentTime + 0.15);
    gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.2);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  },
  returnHome: () => {
    // gentle, descending power-down sweep
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  },
  eat: () => {
    // short, high-pitched blip (coin-collect)
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(900, ctx.currentTime);
    osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.05); // blip up
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  },
  gameOver: () => {
    // jarring, low-frequency descending tone
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(20, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  },
  crash: () => {
    // static noise/jarring tone
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(100, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);

    // Add noise buffer? We can just use multiple detuned oscillators for "jarring static"
    const osc2 = ctx.createOscillator();
    osc2.type = "sawtooth";
    osc2.frequency.setValueAtTime(110, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(25, ctx.currentTime + 0.3);
    osc2.connect(gain);
    osc2.start();
    osc2.stop(ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  },
  bassDrop: () => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc2.type = "sawtooth";
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.8);
    osc2.frequency.setValueAtTime(100, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(10, ctx.currentTime + 0.8);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc2.start();
    osc.stop(ctx.currentTime + 0.8);
    osc2.stop(ctx.currentTime + 0.8);
  },
  heal: () => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc2.type = "triangle";
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.3);
    osc2.frequency.setValueAtTime(600, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc2.start();
    osc.stop(ctx.currentTime + 0.3);
    osc2.stop(ctx.currentTime + 0.3);
  },
  cryo: () => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.8);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  },
  overclock: () => {
    const ctx = getAudioContext();
    if (ctx.state === "suspended") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  },
};

let vfxIdCounter = 0;
const generateId = () => `vfx-${Date.now()}-${vfxIdCounter++}`;

const DIFFICULTY_CONFIG = {
  EASY: {
    initialSpeed: 150,
    increment: 1,
    powerupChance: 0.1,
    obstacleChance: 0.05,
  },
  NORMAL: {
    initialSpeed: 100,
    increment: 1.5,
    powerupChance: 0.15,
    obstacleChance: 0.1,
  },
  HARD: {
    initialSpeed: 70,
    increment: 2,
    powerupChance: 0.2,
    obstacleChance: 0.2,
  },
};

// --- Render Objects ---
class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
  friction: number;

  constructor(x: number, y: number, color: string, speedMult = 1) {
    this.x = x + (Math.random() - 0.5) * 10;
    this.y = y + (Math.random() - 0.5) * 10;
    const velocity = (Math.random() * 8 + 4) * speedMult;
    const angle = Math.random() * Math.PI * 2;
    this.vx = Math.cos(angle) * velocity;
    this.vy = Math.sin(angle) * velocity;
    this.life = 1.0;
    this.color = color;
    this.size = 4;
    this.friction = 0.95;
  }

  update(dt: number) {
    const timeScale = dt / 16.66;
    this.x += this.vx * timeScale;
    this.y += this.vy * timeScale;
    this.vx *= Math.pow(this.friction, timeScale);
    this.vy *= Math.pow(this.friction, timeScale);
    this.life -= 0.02 * timeScale;
  }
}

class TrailParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;

  constructor(x: number, y: number, color: string) {
    this.x = x + (Math.random() - 0.5) * 6;
    this.y = y + (Math.random() - 0.5) * 6;
    this.vx = (Math.random() - 0.5) * 0.5;
    this.vy = (Math.random() - 0.5) * 0.5;
    this.life = 0.5 + Math.random() * 0.5;
    this.color = color;
    this.size = Math.random() * 2 + 1;
  }

  update(dt: number) {
    const ts = dt / 16.66;
    this.x += this.vx * ts;
    this.y += this.vy * ts;
    this.life -= 0.04 * ts;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.globalAlpha = Math.max(0, this.life * 0.5);
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, this.size, this.size);
  }
}

const SnakeGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Game State
  const [gameState, setGameState] = useState<GameState>("START");
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("NORMAL");
  const [gameMode, setGameMode] = useState<GameMode>("SIMULATION");
  const [bootLogs, setBootLogs] = useState<string[]>([]);
  const [snake, setSnake] = useState<Point[]>(INITIAL_SNAKE);
  const [food, setFood] = useState<Point>({ x: 5, y: 5 });
  const [obstacles, setObstacles] = useState<Point[]>([]);
  const [powerups, setPowerups] = useState<PowerupNode[]>([]);

  const [direction, setDirection] = useState<Point>(INITIAL_DIRECTION);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem("neon_snake_highscore_v3");
    return saved ? parseInt(saved, 10) : 0;
  });

  const [speed, setSpeed] = useState(DIFFICULTY_CONFIG.NORMAL.initialSpeed);
  const [isOverclocked, setIsOverclocked] = useState(false);
  const [isCryo, setIsCryo] = useState(false);
  const [isGlitching, setIsGlitching] = useState(false);
  const [shakeType, setShakeType] = useState<"none" | "heavy" | "subtle">(
    "none",
  );
  const [isRespawning, setIsRespawning] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [seedInput, setSeedInput] = useState("");
  const [multiplier, setMultiplier] = useState(1.0);
  const [maxMultiplier, setMaxMultiplier] = useState(1.0);
  const [eatVfxList, setEatVfxList] = useState<EatVFX[]>([]);
  const [highScoreBeaten, setHighScoreBeaten] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [saveStateText, setSaveStateText] = useState("[ SAVE_STATE ]");
  const [theme, setTheme] = useState<ThemeKey>(() => {
    const saved = localStorage.getItem("neon_snake_theme");
    return (saved as ThemeKey) || "NEON";
  });

  useEffect(() => {
    localStorage.setItem("neon_snake_theme", theme);
  }, [theme]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowIntro(false);
    }, 3800);
    return () => clearTimeout(timer);
  }, []);

  const playSound = (soundKey: keyof typeof sounds) => {
    if (!isMuted) sounds[soundKey]();
  };

  // Particles & Refs
  const particlesRef = useRef<Particle[]>([]);
  const trailsRef = useRef<TrailParticle[]>([]);
  const snakeRef = useRef(snake);
  const previousSnakeRef = useRef(snake);
  const directionRef = useRef(direction);
  const nextDirectionRef = useRef(direction);
  const foodRef = useRef(food);
  const obstaclesRef = useRef(obstacles);
  const powerupsRef = useRef(powerups);
  const lastUpdateTimeRef = useRef(0);
  const lastRenderTimeRef = useRef(0);
  const requestRef = useRef<number | null>(null);

  const scoreRef = useRef(0);
  const livesRef = useRef(3);
  const isOverclockedRef = useRef(false);
  const isCryoRef = useRef(false);
  const safeExitRef = useRef(false);
  const isRespawningRef = useRef(false);
  const hasStartedRef = useRef(false);

  const overclockTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const cryoTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const respawnTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const currentMultiplierRef = useRef(1.0);
  const maxMultiplierRef = useRef(1.0);
  const multiplierTimerRef = useRef<{ start: number; duration: number } | null>(
    null,
  );

  const rippleRef = useRef<{
    x: number;
    y: number;
    time: number;
    maxRadius: number;
  } | null>(null);
  const rngRef = useRef<PRNG | null>(null);

  // --- Utilities ---
  const getRandomPoint = useCallback(
    (
      currentSnake: Point[],
      currentObstacles: Point[],
      currentPowerups: Point[],
    ): Point => {
      const r = rngRef.current ? rngRef.current.next() : Math.random();
      const r2 = rngRef.current ? rngRef.current.next() : Math.random();
      const newPoint = {
        x: Math.floor(r * GRID_COLS),
        y: Math.floor(r2 * GRID_ROWS),
      };
      const onSnake = currentSnake.some(
        (p) => p.x === newPoint.x && p.y === newPoint.y,
      );
      const onObstacle = currentObstacles.some(
        (p) => p.x === newPoint.x && p.y === newPoint.y,
      );
      const onPowerup = currentPowerups.some(
        (p) => p.x === newPoint.x && p.y === newPoint.y,
      );

      if (onSnake || onObstacle || onPowerup) {
        return getRandomPoint(currentSnake, currentObstacles, currentPowerups);
      }
      return newPoint;
    },
    [],
  );

  const triggerShake = useCallback((type: "heavy" | "subtle") => {
    setShakeType(type);
    setTimeout(() => setShakeType("none"), type === "heavy" ? 400 : 150);
  }, []);

  const triggerGlitch = () => {
    setIsGlitching(true);
    triggerShake("heavy");
    setTimeout(() => {
      setIsGlitching(false);
    }, 200);
  };

  const spawnParticles = useCallback(
    (
      x: number,
      y: number,
      color: string,
      speedMult: number = 1,
      count: number = 30
    ) => {
      for (let i = 0; i < count; i++) {
        const p = new Particle(x, y, color, speedMult);
        particlesRef.current.push(p);
      }
    },
    [],
  );

  const startBootSequence = () => {
    initAudioEngine();
    playSound("startGame");
    setGameState("BOOTING");
    const logs = [
      "INITIALIZING NEON_CORE...",
      "MOUNTING PHYSICS_ENGINE [OK]",
      `CONFIGURING SYSTEM_DIFFICULTY: ${difficulty}...`,
      "ALLOCATING GRID_BUFFER (25x25)...",
      "SYNCING PORTAL_GATES...",
      "LOADING CORRUPTED_SECTOR_MAP...",
      "STARTING OVERCLOCK_DAEMON...",
      "STARTING CRYO_PROTOCOL...",
      "EXECUTING Main()...",
    ];

    logs.forEach((log, i) => {
      setTimeout(() => {
        setBootLogs((prev) => [...prev, log]);
        if (i === logs.length - 1) {
          setTimeout(() => resetGame(), 500);
        }
      }, i * 200);
    });
  };

  const resetGame = () => {
    if (seedInput.trim()) {
      rngRef.current = new PRNG(hashString(seedInput.trim()));
    } else {
      rngRef.current = null;
    }

    const config = DIFFICULTY_CONFIG[difficulty];
    setSnake(INITIAL_SNAKE);
    snakeRef.current = INITIAL_SNAKE;
    setDirection(INITIAL_DIRECTION);
    directionRef.current = INITIAL_DIRECTION;
    nextDirectionRef.current = INITIAL_DIRECTION;

    setScore(0);
    scoreRef.current = 0;

    setLives(3);
    livesRef.current = 3;

    setMultiplier(1.0);
    setMaxMultiplier(1.0);
    currentMultiplierRef.current = 1.0;
    maxMultiplierRef.current = 1.0;
    multiplierTimerRef.current = null;
    setHighScoreBeaten(false);

    rippleRef.current = null;
    previousSnakeRef.current = INITIAL_SNAKE;
    setSpeed(config.initialSpeed);

    setIsOverclocked(false);
    isOverclockedRef.current = false;

    setIsCryo(false);
    isCryoRef.current = false;

    setObstacles([]);
    obstaclesRef.current = [];

    setPowerups([]);
    powerupsRef.current = [];

    safeExitRef.current = false;

    setFood(getRandomPoint(INITIAL_SNAKE, [], []));
    setGameState("PLAYING");
    hasStartedRef.current = gameMode === "SIMULATION";
    lastUpdateTimeRef.current = performance.now();
  };

  const resumeEngineRef = useRef<() => void>();

  // Ensure Simulation mode auto-starts immediately
  useEffect(() => {
    if (
      gameState === "PLAYING" &&
      gameMode === "SIMULATION" &&
      !hasStartedRef.current
    ) {
      hasStartedRef.current = true;
      resumeEngineRef.current?.();
    }
  }, [gameState, gameMode]);

  // Input
  const handleDirectionChange = useCallback(
    (newDir: Point) => {
      initAudioEngine();
      if (gameState !== "PLAYING") return;

      if (!hasStartedRef.current) {
        hasStartedRef.current = true;
        resumeEngineRef.current?.();
      }

      if (newDir.y !== 0 && directionRef.current.y === 0)
        nextDirectionRef.current = newDir;
      if (newDir.x !== 0 && directionRef.current.x === 0)
        nextDirectionRef.current = newDir;
    },
    [gameState],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState !== "PLAYING") return;

      switch (e.key) {
        case "ArrowUp":
        case "w":
        case "W":
          handleDirectionChange({ x: 0, y: -1 });
          break;
        case "ArrowDown":
        case "s":
        case "S":
          handleDirectionChange({ x: 0, y: 1 });
          break;
        case "ArrowLeft":
        case "a":
        case "A":
          handleDirectionChange({ x: -1, y: 0 });
          break;
        case "ArrowRight":
        case "d":
        case "D":
          handleDirectionChange({ x: 1, y: 0 });
          break;
        case " ":
          playSound("pauseGame");
          setGameState("PAUSED");
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameState]);

  const handleCrash = () => {
    const newLives = livesRef.current - 1;
    const canvas = canvasRef.current;

    if (canvas) {
      playSound("bassDrop");
      const currentTheme = THEMES[theme];
      const cellSize = canvas.width / GRID_COLS;
      snakeRef.current.forEach((seg) => {
        spawnParticles(
          seg.x * cellSize + cellSize / 2,
          seg.y * cellSize + cellSize / 2,
          currentTheme.particleBase,
          1,
          10
        );
      });
    } else {
      playSound(newLives <= 0 ? "gameOver" : "crash");
    }

    triggerGlitch();
    setLives(Math.max(0, newLives));
    livesRef.current = Math.max(0, newLives);

    if (newLives <= 0) {
      setGameState("GAME_OVER");
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    } else {
      // Wait 1.5 seconds and respawn
      setIsRespawning(true);
      isRespawningRef.current = true;
      hasStartedRef.current = false; // Freeze the internal update loop logic tick

      setSnake(INITIAL_SNAKE);
      snakeRef.current = INITIAL_SNAKE;
      previousSnakeRef.current = INITIAL_SNAKE;
      setDirection(INITIAL_DIRECTION);
      directionRef.current = INITIAL_DIRECTION;
      nextDirectionRef.current = INITIAL_DIRECTION;

      if (respawnTimeoutRef.current) clearTimeout(respawnTimeoutRef.current);
      respawnTimeoutRef.current = setTimeout(() => {
        setIsOverclocked(false);
        isOverclockedRef.current = false;
        if (overclockTimeoutRef.current)
          clearTimeout(overclockTimeoutRef.current);

        setIsCryo(false);
        isCryoRef.current = false;
        if (cryoTimeoutRef.current) clearTimeout(cryoTimeoutRef.current);

        safeExitRef.current = true; // Temporary invulnerability
        setTimeout(() => (safeExitRef.current = false), 1000);

        setIsRespawning(false);
        isRespawningRef.current = false;
        hasStartedRef.current = gameMode === "SIMULATION"; // Wait for keypress in Classic, auto-start in Sim
        lastUpdateTimeRef.current = performance.now(); // reset delta time so it doesn't instantly snap
        resumeEngineRef.current?.();
      }, 1500);
    }
  };

  const saveGameState = () => {
    initAudioEngine();
    playSound("click");
    const state: SavedState = {
      snake: snakeRef.current,
      food: foodRef.current,
      obstacles: obstaclesRef.current,
      powerups: powerupsRef.current,
      score: scoreRef.current,
      lives: livesRef.current,
      difficulty,
      speed,
      gameMode,
      rngState: rngRef.current ? rngRef.current.getState() : undefined,
      direction: directionRef.current,
    };
    localStorage.setItem("neon_snake_saved_state", JSON.stringify(state));
    triggerGlitch();
    setSaveStateText("[ STATE_SAVED ]");
    setTimeout(() => setSaveStateText("[ SAVE_STATE ]"), 1500);
  };

  const loadGameState = () => {
    initAudioEngine();
    playSound("click");
    const saved = localStorage.getItem("neon_snake_saved_state");
    if (!saved) return;

    try {
      const state: SavedState = JSON.parse(saved);
      setSnake(state.snake);
      snakeRef.current = state.snake;
      previousSnakeRef.current = [...state.snake];
      setFood(state.food);
      foodRef.current = state.food;
      setObstacles(state.obstacles);
      obstaclesRef.current = state.obstacles;
      setPowerups(state.powerups || []);
      powerupsRef.current = state.powerups || [];
      setScore(state.score);
      scoreRef.current = state.score;
      setLives(state.lives ?? 3);
      livesRef.current = state.lives ?? 3;
      setDifficulty(state.difficulty);
      setSpeed(state.speed);
      if (state.gameMode) setGameMode(state.gameMode);
      if (state.direction) {
        directionRef.current = state.direction;
        nextDirectionRef.current = state.direction;
      }
      if (state.rngState !== undefined) {
        rngRef.current = new PRNG(parseInt(state.rngState.toString(), 10)); // just in case
        rngRef.current["a"] = state.rngState; // hard set current state
      }

      snakeRef.current = state.snake;
      previousSnakeRef.current = state.snake;
      foodRef.current = state.food;
      obstaclesRef.current = state.obstacles;
      powerupsRef.current = state.powerups || [];

      triggerGlitch();
      hasStartedRef.current = false;
      setGameState("PLAYING");
    } catch (e) {
      console.error("Failed to load state", e);
    }
  };

  // --- Game Logic ---
  const update = useCallback(
    (time: number) => {
      if (!lastUpdateTimeRef.current) lastUpdateTimeRef.current = time;
      if (!lastRenderTimeRef.current) lastRenderTimeRef.current = time;
      const renderDt = time - lastRenderTimeRef.current;
      lastRenderTimeRef.current = time;

      // Engine Base Speed modifier based on buffs
      const baseSpeed = speed;
      let currentSpeed = baseSpeed;
      if (isCryoRef.current) currentSpeed = baseSpeed * 1.6;
      if (isOverclockedRef.current) currentSpeed = baseSpeed / 2;

      // 1. Logic Tick
      if (gameState === "PLAYING" && !isRespawningRef.current) {
        const deltaTime = time - lastUpdateTimeRef.current;
        if (deltaTime >= currentSpeed) {
          lastUpdateTimeRef.current = time;
          previousSnakeRef.current = [...snakeRef.current];

          const nextDir = nextDirectionRef.current;

          let shouldContinueMovement = true;

          if (!hasStartedRef.current) {
            lastUpdateTimeRef.current = time;
            shouldContinueMovement = false;
          }

          if (shouldContinueMovement) {
            const rawX = snakeRef.current[0].x + nextDir.x;
            const rawY = snakeRef.current[0].y + nextDir.y;

            let newHead: Point;
            let hitWall = false;

            if (
              rawX < 0 ||
              rawX >= GRID_COLS ||
              rawY < 0 ||
              rawY >= GRID_ROWS
            ) {
              hitWall = true;
            }

            if (gameMode === "CLASSIC" && hitWall) {
              handleCrash();
              shouldContinueMovement = false;
            }

            if (shouldContinueMovement) {
              newHead = {
                x: (rawX + GRID_COLS) % GRID_COLS,
                y: (rawY + GRID_ROWS) % GRID_ROWS,
              };

              directionRef.current = nextDir;

              // Collision Check exemption (Safe-exit logic for Overclock)
              if (isOverclockedRef.current) {
                safeExitRef.current = true;
              } else if (safeExitRef.current) {
                let collisionFree = true;
                for (let i = 0; i < snakeRef.current.length; i++) {
                  const seg = snakeRef.current[i];
                  if (
                    obstaclesRef.current.some(
                      (o) => o.x === seg.x && o.y === seg.y,
                    )
                  )
                    collisionFree = false;
                  for (let j = i + 1; j < snakeRef.current.length; j++) {
                    if (
                      seg.x === snakeRef.current[j].x &&
                      seg.y === snakeRef.current[j].y
                    )
                      collisionFree = false;
                  }
                }
                if (collisionFree) {
                  safeExitRef.current = false;
                }
              }
              const isInvincible =
                isOverclockedRef.current || safeExitRef.current;

              let crashed = false;
              if (!isInvincible) {
                if (
                  obstaclesRef.current.some(
                    (p) => p.x === newHead!.x && p.y === newHead!.y,
                  )
                ) {
                  crashed = true;
                }
                if (
                  snakeRef.current.some(
                    (p) => p.x === newHead!.x && p.y === newHead!.y,
                  )
                ) {
                  crashed = true;
                }
              }

              if (crashed) {
                handleCrash();
                shouldContinueMovement = false;
              }

              if (shouldContinueMovement) {
                const newSnake = [newHead!, ...snakeRef.current];
                const config = DIFFICULTY_CONFIG[difficulty];

                // Check Food
                if (
                  newHead.x === foodRef.current.x &&
                  newHead.y === foodRef.current.y
                ) {
                  playSound("eat");

                  // Combo System
                  const MULTIPLIER_WINDOW = 3000;
                  const MULTIPLIER_STEPS = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
                  let currentMult = currentMultiplierRef.current;
                  if (!multiplierTimerRef.current) {
                    currentMult = 1.0;
                  } else {
                    const currentIndex = MULTIPLIER_STEPS.indexOf(
                      currentMultiplierRef.current,
                    );
                    const nextIndex = Math.min(
                      currentIndex === -1 ? 0 : currentIndex + 1,
                      MULTIPLIER_STEPS.length - 1,
                    );
                    currentMult = MULTIPLIER_STEPS[nextIndex];
                  }
                  currentMultiplierRef.current = currentMult;
                  setMultiplier(currentMult);
                  if (currentMult > maxMultiplierRef.current) {
                    maxMultiplierRef.current = currentMult;
                    setMaxMultiplier(currentMult);
                  }
                  multiplierTimerRef.current = {
                    start: time,
                    duration: MULTIPLIER_WINDOW,
                  };

                  const points = Math.floor(
                    (isOverclockedRef.current ? 50 : 10) * currentMult,
                  );
                  setScore((prev) => {
                    const newScore = prev + points;
                    scoreRef.current = newScore;
                    if (newScore > highScore) {
                      setHighScoreBeaten(true);
                      setHighScore(newScore);
                      localStorage.setItem(
                        "neon_snake_highscore_v3",
                        newScore.toString(),
                      );
                    }
                    return newScore;
                  });

                  setSpeed((prev) => Math.max(MIN_SPEED, prev - config.increment));

                  const currentTheme = THEMES[theme];
                  const newId = generateId();
                  const isSpecial =
                    isOverclockedRef.current || currentMult >= 2.0;

                  setEatVfxList((prev) => [
                    ...prev,
                    {
                      id: newId,
                      x: newHead.x,
                      y: newHead.y,
                      text: `+${points}`,
                      color: isOverclockedRef.current
                        ? "#FFA500"
                        : currentTheme.particleBase,
                      isSpecial,
                      dx: (Math.random() - 0.5) * 50,
                      dy: -30 - Math.random() * 30,
                    },
                  ]);

                  setTimeout(() => {
                    setEatVfxList((prev) => prev.filter((v) => v.id !== newId));
                  }, 1000);

                  triggerShake("subtle");

                  const canvas = canvasRef.current;
                  if (canvas) {
                    const cellSize = canvas.width / GRID_COLS;
                    spawnParticles(
                      newHead.x * cellSize + cellSize / 2,
                      newHead.y * cellSize + cellSize / 2,
                      isOverclockedRef.current ? "#FFA500" : currentTheme.particleBase,
                      1,
                      30
                    );
                  }

                  if (
                    gameMode === "SIMULATION" &&
                    (rngRef.current ? rngRef.current.next() : Math.random()) <
                      config.obstacleChance
                  ) {
                    const obs = getRandomPoint(
                      newSnake,
                      obstaclesRef.current,
                      powerupsRef.current,
                    );
                    setObstacles((prev) => [...prev, obs]);
                    obstaclesRef.current.push(obs);
                  }

                  if (
                    powerupsRef.current.length < 3 &&
                    (rngRef.current ? rngRef.current.next() : Math.random()) <
                      config.powerupChance
                  ) {
                    const p = getRandomPoint(
                      newSnake,
                      obstaclesRef.current,
                      powerupsRef.current,
                    );
                    const roll = rngRef.current
                      ? rngRef.current.next()
                      : Math.random();
                    const type: PowerupType =
                      roll < 0.4 ? "OVERCLOCK" : roll < 0.8 ? "CRYO" : "HEART";
                    const pu: PowerupNode = { ...p, type };
                    powerupsRef.current.push(pu);
                    setPowerups([...powerupsRef.current]);
                  }

                  const newFood = getRandomPoint(
                    newSnake,
                    obstaclesRef.current,
                    powerupsRef.current,
                  );
                  setFood(newFood);
                  foodRef.current = newFood;
                  rippleRef.current = {
                    x: newFood.x,
                    y: newFood.y,
                    time,
                    maxRadius: 3,
                  };
                  setSpeed((prev) =>
                    Math.max(MIN_SPEED, prev - config.increment),
                  );
                } else {
                  // Check Powerups
                  const puIdx = powerupsRef.current.findIndex(
                    (p) => p.x === newHead.x && p.y === newHead.y,
                  );
                  if (puIdx !== -1) {
                    const pu = powerupsRef.current.splice(puIdx, 1)[0];
                    setPowerups([...powerupsRef.current]);

                    const canvas = canvasRef.current;
                    const cellSize = canvas ? canvas.width / GRID_COLS : 0;
                    const pX = newHead.x * cellSize + cellSize / 2;
                    const pY = newHead.y * cellSize + cellSize / 2;

                    if (pu.type === "HEART") {
                      playSound("heal");
                      const newL = Math.min(3, livesRef.current + 1);
                      livesRef.current = newL;
                      setLives(newL);
                      if (canvas)
                        spawnParticles(pX, pY, "#FF00FF", 1, 30);

                      const newId = generateId();
                      setEatVfxList((prev) => [
                        ...prev,
                        {
                          id: newId,
                          x: newHead.x,
                          y: newHead.y,
                          text: "+INTEGRITY",
                          color: "#FF00FF",
                          isSpecial: true,
                          dx: 0,
                          dy: -40,
                        },
                      ]);
                      setTimeout(
                        () =>
                          setEatVfxList((prev) =>
                            prev.filter((v) => v.id !== newId),
                          ),
                        1000,
                      );
                      triggerShake("subtle");
                    } else if (pu.type === "OVERCLOCK") {
                      playSound("overclock");
                      setIsOverclocked(true);
                      isOverclockedRef.current = true;
                      triggerShake("subtle");
                      if (overclockTimeoutRef.current)
                        clearTimeout(overclockTimeoutRef.current);
                      overclockTimeoutRef.current = setTimeout(() => {
                        setIsOverclocked(false);
                        isOverclockedRef.current = false;
                      }, OVERCLOCK_DURATION);
                      if (canvas)
                        spawnParticles(pX, pY, "#FFA500", 1, 30);

                      const newId = generateId();
                      setEatVfxList((prev) => [
                        ...prev,
                        {
                          id: newId,
                          x: newHead.x,
                          y: newHead.y,
                          text: "OVERCLOCK",
                          color: "#FFA500",
                          isSpecial: true,
                          dx: (Math.random() - 0.5) * 40,
                          dy: -40,
                        },
                      ]);
                      setTimeout(
                        () =>
                          setEatVfxList((prev) =>
                            prev.filter((v) => v.id !== newId),
                          ),
                        1000,
                      );
                    } else if (pu.type === "CRYO") {
                      playSound("cryo");
                      setIsCryo(true);
                      isCryoRef.current = true;
                      triggerShake("subtle");
                      if (cryoTimeoutRef.current)
                        clearTimeout(cryoTimeoutRef.current);
                      cryoTimeoutRef.current = setTimeout(() => {
                        setIsCryo(false);
                        isCryoRef.current = false;
                      }, 8000);
                      if (canvas)
                        spawnParticles(pX, pY, "#0088FF", 1, 30);

                      const newId = generateId();
                      setEatVfxList((prev) => [
                        ...prev,
                        {
                          id: newId,
                          x: newHead.x,
                          y: newHead.y,
                          text: "CRYO_STATE",
                          color: "#0088FF",
                          isSpecial: true,
                          dx: (Math.random() - 0.5) * 40,
                          dy: -30,
                        },
                      ]);
                      setTimeout(
                        () =>
                          setEatVfxList((prev) =>
                            prev.filter((v) => v.id !== newId),
                          ),
                        1000,
                      );
                    }
                    newSnake.pop();
                  } else {
                    newSnake.pop();
                  }
                }

                setSnake(newSnake);
                snakeRef.current = newSnake;
              }
            }
          }
        }
      }

      // 2. Physics / Particles / Combo Decay
      if (gameState === "PLAYING") {
        if (multiplierTimerRef.current) {
          const elapsed = time - multiplierTimerRef.current.start;
          if (elapsed > multiplierTimerRef.current.duration) {
            multiplierTimerRef.current = null;
            currentMultiplierRef.current = 1.0;
            setMultiplier(1.0);
          }
        }

        particlesRef.current = particlesRef.current.filter((p) => p.life > 0);
        particlesRef.current.forEach((p) => p.update(renderDt));
        trailsRef.current = trailsRef.current.filter((p) => p.life > 0);
        trailsRef.current.forEach((p) => p.update(renderDt));
      }

      // 3. Rendering
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const size = canvas.width / GRID_COLS;
          const renderProgress =
            gameState === "PLAYING"
              ? Math.min((time - lastUpdateTimeRef.current) / currentSpeed, 1)
              : 1;
          const currentScore = scoreRef.current;

          const currentTheme = THEMES[theme];

          ctx.fillStyle = currentTheme.bgInner;
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          const resonance = Math.min(currentScore / 500, 1);
          const gridPulse = Math.sin(time / 200) * 0.5 + 0.5;

          ctx.lineWidth = 1;
          for (let i = 0; i <= Math.max(GRID_COLS, GRID_ROWS); i++) {
            const pos = i * size;
            const shiftX =
              gameState === "PLAYING"
                ? Math.sin(time / 500 + i) * resonance * 2
                : 0;
            const shiftY =
              gameState === "PLAYING"
                ? Math.cos(time / 500 + i) * resonance * 2
                : 0;

            ctx.strokeStyle = isOverclockedRef.current
              ? `rgba(51, 34, 0, ${0.5 + gridPulse * 0.5})`
              : isCryoRef.current
                ? `rgba(0, 34, 51, ${0.5 + gridPulse * 0.5})`
                : `rgba(${currentTheme.gridBase}, ${0.3 + resonance * 0.6 + gridPulse * 0.1})`;

            if (i <= GRID_COLS) {
              ctx.beginPath();
              ctx.moveTo(pos + shiftX, 0);
              ctx.lineTo(pos + shiftX, canvas.height);
              ctx.stroke();
            }

            if (i <= GRID_ROWS) {
              ctx.beginPath();
              ctx.moveTo(0, pos + shiftY);
              ctx.lineTo(canvas.width, pos + shiftY);
              ctx.stroke();
            }
          }

          obstaclesRef.current.forEach((obs) => {
            ctx.fillStyle = "#FF0000";
            ctx.shadowBlur = 10 + currentScore / 100;
            ctx.shadowColor = "#FF0000";
            ctx.fillRect(
              obs.x * size + 4,
              obs.y * size + 4,
              size - 8,
              size - 8,
            );
            ctx.strokeStyle = "#660000";
            ctx.strokeRect(
              obs.x * size + 2,
              obs.y * size + 2,
              size - 4,
              size - 4,
            );
          });

          powerupsRef.current.forEach((pu) => {
            const pX = pu.x * size + size / 2;
            const pY = pu.y * size + size / 2;
            ctx.beginPath();
            ctx.arc(pX, pY, size * 0.3, 0, Math.PI * 2);

            if (pu.type === "HEART") {
              ctx.fillStyle = "#FF00FF";
              ctx.shadowBlur = 20 + gridPulse * 10;
              ctx.shadowColor = "#FF00FF";
            } else if (pu.type === "CRYO") {
              ctx.fillStyle = "#0088FF";
              ctx.shadowBlur = 20 + gridPulse * 10;
              ctx.shadowColor = "#0088FF";
            } else if (pu.type === "OVERCLOCK") {
              ctx.fillStyle = "#FFA500";
              ctx.shadowBlur = 20 + gridPulse * 10;
              ctx.shadowColor = "#FFA500";
            }
            ctx.fill();
          });

          if (rippleRef.current) {
            const rTime = time - rippleRef.current.time;
            if (rTime < 500) {
              const rProgress = rTime / 500;
              const maxRad = rippleRef.current.maxRadius * size;
              const rWidth = maxRad * Math.sqrt(rProgress);
              ctx.strokeStyle = `rgba(${currentTheme.snakeBase}, ${1 - rProgress})`;
              ctx.lineWidth = 1 + (1 - rProgress) * 2;
              ctx.shadowBlur = 10;
              ctx.shadowColor = currentTheme.particleBase;

              const rX = rippleRef.current.x * size + size / 2;
              const rY = rippleRef.current.y * size + size / 2;
              ctx.strokeRect(rX - rWidth / 2, rY - rWidth / 2, rWidth, rWidth);
            }
          }

          const fX = foodRef.current.x * size + size / 2;
          const fY = foodRef.current.y * size + size / 2;
          ctx.shadowBlur = 15 + Math.min(currentScore / 100, 15);
          ctx.shadowColor = "#FF0055";
          ctx.fillStyle = "#FF0055";
          ctx.save();
          ctx.translate(fX, fY);
          ctx.rotate(time / 300);
          ctx.fillRect(-size / 4, -size / 4, size / 2, size / 2);
          ctx.restore();

          ctx.shadowBlur = 0;
          trailsRef.current.forEach((p) => p.draw(ctx));

          const curSnake = snakeRef.current;
          const prevSnake = previousSnakeRef.current;

          for (let i = curSnake.length - 1; i >= 0; i--) {
            const seg = curSnake[i];
            const prevSeg = prevSnake[i] || seg;

            let drawX = prevSeg.x + (seg.x - prevSeg.x) * renderProgress;
            let drawY = prevSeg.y + (seg.y - prevSeg.y) * renderProgress;

            if (seg.x - prevSeg.x < -1) {
              drawX = prevSeg.x + 1 * renderProgress;
              if (drawX > GRID_COLS - 0.5) drawX -= GRID_COLS;
            } else if (seg.x - prevSeg.x > 1) {
              drawX = prevSeg.x - 1 * renderProgress;
              if (drawX < -0.5) drawX += GRID_COLS;
            }
            if (seg.y - prevSeg.y < -1) {
              drawY = prevSeg.y + 1 * renderProgress;
              if (drawY > GRID_ROWS - 0.5) drawY -= GRID_ROWS;
            } else if (seg.y - prevSeg.y > 1) {
              drawY = prevSeg.y - 1 * renderProgress;
              if (drawY < -0.5) drawY += GRID_ROWS;
            }

            const x = drawX * size;
            const y = drawY * size;

            if (gameState === "PLAYING" && i === 0 && Math.random() < 0.3) {
              trailsRef.current.push(
                new TrailParticle(
                  x + size / 2,
                  y + size / 2,
                  isOverclockedRef.current
                    ? "#FFA500"
                    : isCryoRef.current
                      ? "#0088FF"
                      : currentTheme.particleBase,
                ),
              );
            }

            const opacity = Math.max(0.1, 1 - i / curSnake.length);

            let snakeColor = `rgba(${currentTheme.snakeBase}, ${opacity})`;
            let snakeShadow = currentTheme.particleBase;
            if (isOverclockedRef.current) {
              snakeColor = `rgba(255, 165, 0, ${opacity})`;
              snakeShadow = snakeColor;
            } else if (isCryoRef.current) {
              snakeColor = `rgba(0, 136, 255, ${opacity})`;
              snakeShadow = snakeColor;
            }

            ctx.shadowBlur =
              i === 0 ? 37 + Math.min(currentScore / 33, 30) : 15;
            ctx.shadowColor = snakeShadow;
            ctx.fillStyle = snakeColor;

            if (safeExitRef.current && Math.random() < 0.5) {
              ctx.globalAlpha = 0.5; // flicker effect when ghosting
            } else {
              ctx.globalAlpha = 1.0;
            }

            const drawBlock = (bx: number, by: number) => {
              if (i === 0) {
                ctx.fillRect(bx + 1, by + 1, size - 2, size - 2);
              } else {
                ctx.fillRect(bx + 2, by + 2, size - 4, size - 4);
              }
            };

            drawBlock(x, y);

            if (drawX > GRID_COLS - 1) drawBlock(x - GRID_COLS * size, y);
            if (drawX < 0) drawBlock(x + GRID_COLS * size, y);
            if (drawY > GRID_ROWS - 1) drawBlock(x, y - GRID_ROWS * size);
            if (drawY < 0) drawBlock(x, y + GRID_ROWS * size);

            ctx.globalAlpha = 1.0;
          }

          ctx.shadowBlur = 8;
          particlesRef.current.forEach((p) => {
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.shadowColor = p.color;
            ctx.fillRect(p.x, p.y, p.size, p.size);
          });
          ctx.globalAlpha = 1.0;
        }
      }

      if (gameState !== "GAME_OVER") {
        requestRef.current = requestAnimationFrame(update);
      }
    },
    [
      gameState,
      speed,
      highScore,
      difficulty,
      gameMode,
      getRandomPoint,
      spawnParticles,
      theme,
    ],
  );

  useEffect(() => {
    resumeEngineRef.current = () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      requestRef.current = requestAnimationFrame(update);
    };

    // Auto-start loop when update callback changes
    requestRef.current = requestAnimationFrame(update);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [update]);

  // Resize
  useEffect(() => {
    const resize = () => {
      if (canvasRef.current && containerRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const currentTheme = THEMES[theme];

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center p-2 md:p-6 overflow-hidden bg-black font-mono transition-colors duration-1000 touch-none"
      style={{
        color: currentTheme.uiText,
        backgroundImage: `radial-gradient(circle at 50% 50%, ${currentTheme.bgOuter} 0%, ${currentTheme.bgInner} 100%)`,
      }}
    >
      <AnimatePresence>
        {showIntro && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black overflow-hidden flex-col gap-4"
          >
            <motion.div
               className="relative"
               initial={{ opacity: 0, scale: 0.8, filter: "blur(10px)" }}
               animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
               transition={{ duration: 1.5, ease: "easeOut" }}
            >
               <motion.div
                  initial={{ clipPath: "polygon(0 0, 100% 0, 100% 0, 0 0)" }}
                  animate={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)" }}
                  transition={{ duration: 0.8, delay: 0.5, ease: "circInOut" }}
                  className="text-4xl md:text-7xl font-bold tracking-[0.4em] uppercase text-center"
                  style={{
                    color: currentTheme.uiText,
                    textShadow: `0 0 20px ${currentTheme.particleBase}`,
                  }}
               >
                 NEON
                 <br />
                 STREAM
                 <br />
                 SNAKE
               </motion.div>
               
               {/* Scanline effect for logo */}
               <motion.div
                 className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-50"
                 style={{
                    backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(${currentTheme.snakeBase}, 0.2) 2px, rgba(${currentTheme.snakeBase}, 0.2) 4px)`,
                 }}
                 animate={{ backgroundPosition: ["0px 0px", "0px 20px"] }}
                 transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
               />
               
               {/* Glitch flash */}
               <motion.div
                  className="absolute inset-0 bg-white z-10"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 1, 0, 0.5, 0] }}
                  transition={{ duration: 0.4, delay: 1.8 }}
                  style={{ mixBlendMode: 'overlay' }}
               />
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 2.2 }}
              className="text-[10px] tracking-widest uppercase mt-8"
              style={{ color: currentTheme.hudMuted }}
            >
              INITIALIZING CORE...
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col items-center w-full relative">
        {/* HUD */}
        {(gameState === "PLAYING" || gameState === "PAUSED") && (
          <div
            className="w-full max-w-[min(95vw,75vh)] mx-auto flex flex-row flex-wrap justify-between items-end mb-2 text-sm sm:text-base font-bold select-none tracking-widest gap-2"
            style={{ color: currentTheme.uiText }}
          >
            <div className="flex flex-wrap items-center gap-2 md:gap-4">
              <div className="flex items-center gap-2">
                <span style={{ color: currentTheme.hudMuted }}>SCORE:</span>
                <span className="text-xs sm:text-[16px]">{score}</span>
              </div>

              <div
                className={`flex items-center gap-2 transition-opacity ${multiplier > 1.0 ? "opacity-100" : "opacity-0"}`}
              >
                <span style={{ color: currentTheme.hudMuted }}>COMBO:</span>
                <span
                  className="text-xs sm:text-[16px]"
                  style={{ color: currentTheme.particleBase }}
                >
                  {multiplier.toFixed(1)}x
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span style={{ color: currentTheme.hudMuted }}>
                  INTEGRITY:
                </span>
                <span className="text-[#FF00FF]">
                  {Array(lives).fill("♥").join(" ")}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span style={{ color: currentTheme.hudMuted }}>HIGH:</span>
                <span
                  className={`flex items-center gap-1 transition-colors ${highScoreBeaten ? "animate-pulse" : ""}`}
                  style={{
                    color: highScoreBeaten
                      ? currentTheme.particleBase
                      : undefined,
                  }}
                >
                  <Trophy size={14} />
                  {highScore}
                </span>
              </div>
              <div className="flex items-center gap-2 opacity-50">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="hover:opacity-100 transition-opacity flex items-center gap-1"
                >
                  {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                  <span>{isMuted ? "[ AUDIO : MUTE ]" : "[ AUDIO : ON ]"}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div
          ref={containerRef}
          className={`relative w-full max-w-[min(95vw,75vh)] mx-auto aspect-[4/3] rounded bg-black
            ${isGlitching ? "translate-x-2 -translate-y-1" : ""}
            ${shakeType === "heavy" ? "shake-heavy" : shakeType === "subtle" ? "shake-subtle" : ""}
          `}
          style={{
            border: `1px solid ${currentTheme.gridBorder}`,
            boxShadow: isOverclocked
              ? "0 0 100px rgba(255,165,0,0.2)"
              : isCryo
                ? "0 0 100px rgba(0,136,255,0.2)"
                : `0 0 50px rgba(${currentTheme.snakeBase},0.05)`,
            transition: "box-shadow 0.5s ease-out, border-color 1s ease",
          }}
        >
          <style>
            {`
              @keyframes dataStream {
                0% { background-position: 0px 0px; opacity: 0.5; filter: brightness(1); transform: scale(1); }
                50% { opacity: 1; filter: brightness(1.5); transform: scale(1.01); }
                100% { background-position: 0px 100px; opacity: 0.5; filter: brightness(1); transform: scale(1); }
              }
            `}
          </style>
          <div
            className="absolute inset-0 pointer-events-none origin-center"
            style={{
              backgroundImage: `
                repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(${currentTheme.snakeBase}, 0.06) 2px, rgba(${currentTheme.snakeBase}, 0.06) 4px),
                repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(${currentTheme.snakeBase}, 0.03) 2px, rgba(${currentTheme.snakeBase}, 0.03) 4px)
              `,
              backgroundSize: "100px 100px",
              zIndex: 20,
              animation: "dataStream 20s linear infinite",
            }}
          />

          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{
              filter: isGlitching ? "hue-rotate(90deg) contrast(200%)" : "none",
            }}
          />

          {/* CSS VFX Engine */}
          {eatVfxList.map((vfx) => (
            <div
              key={vfx.id}
              className="absolute z-20 pointer-events-none"
              style={{
                left: `${(vfx.x / GRID_COLS) * 100}%`,
                top: `${(vfx.y / GRID_ROWS) * 100}%`,
                width: `${100 / GRID_COLS}%`,
                height: `${100 / GRID_ROWS}%`,
              }}
            >
              {/* Ripple */}
              <motion.div
                initial={{
                  opacity: 0.8,
                  scale: 1,
                  borderWidth: vfx.isSpecial ? 4 : 2,
                }}
                animate={{
                  opacity: 0,
                  scale: vfx.isSpecial ? 5 : 3,
                  borderWidth: 0,
                }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="absolute inset-0 rounded-sm"
                style={{ borderColor: vfx.color }}
              />

              {/* Floating Text */}
              <motion.div
                initial={{ opacity: 1, scale: 0.5, x: "-50%", y: "-50%" }}
                animate={{
                  opacity: 0,
                  scale: 1.5,
                  x: `calc(-50% + ${vfx.dx}px)`,
                  y: `calc(-50% + ${vfx.dy}px)`,
                }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="absolute text-[10px] md:text-sm font-bold whitespace-nowrap"
                style={{
                  color: vfx.color,
                  textShadow: `0 0 10px ${vfx.color}`,
                  left: "50%",
                  top: "50%",
                }}
              >
                {vfx.text}
              </motion.div>
            </div>
          ))}


          {/* Active Buff Indicators */}
          <div className="absolute bottom-4 left-6 flex gap-4 z-10 font-bold select-none text-xs tracking-widest">
            <AnimatePresence>
              {isOverclocked && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0 }}
                  className="flex items-center gap-2 text-[#FFA500]"
                >
                  <Zap size={14} />
                  <span>OVERCLOCK_ACTIVE</span>
                </motion.div>
              )}
              {isCryo && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0 }}
                  className="flex items-center gap-2 text-[#0088FF]"
                >
                  <Snowflake size={14} />
                  <span>CRYO_PROTOCOL</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Get Ready Overlay for Respawn */}
          <AnimatePresence>
            {isRespawning && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none"
                style={{
                  backgroundColor: "rgba(0,0,0,0.4)",
                  backdropFilter: "blur(2px)",
                }}
              >
                <div
                  className="text-4xl font-bold tracking-[0.3em] font-mono text-center"
                  style={{
                    color: currentTheme.uiText,
                    textShadow: `0 0 20px ${currentTheme.particleBase}`,
                  }}
                >
                  GET READY
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Boot Sequence / Screen */}
          <AnimatePresence>
            {gameState === "BOOTING" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-[#050505] z-50 p-8 flex flex-col justify-end"
              >
                <div className="font-mono text-xs text-[#00FFFF] space-y-2 mb-8">
                  {bootLogs.map((log, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                    >
                      {`> ${log}`}
                    </motion.div>
                  ))}
                  <motion.div
                    animate={{ opacity: [1, 0] }}
                    transition={{
                      duration: 0.5,
                      repeat: Infinity,
                      repeatType: "reverse",
                    }}
                  >
                    _
                  </motion.div>
                </div>
              </motion.div>
            )}

            {gameState === "START" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-[#0A0A0A]/90 backdrop-blur z-40 overflow-y-auto max-h-[100dvh]"
              >
                <div className="flex flex-col items-center justify-center min-h-full py-12 md:py-8">
                  <div
                    className="mb-1 text-[10px] tracking-[0.5em] font-bold text-center"
                    style={{ color: currentTheme.uiText }}
                  >
                    SYSTEM_READY
                  </div>
                  <h1 className="text-4xl font-bold mb-2 tracking-tighter text-white">
                    NEON_STREAM//OS
                  </h1>

                  <div
                    className="flex items-center gap-2 mb-8 md:mb-4 text-[12px] tracking-widest font-bold"
                    style={{ color: currentTheme.particleBase }}
                  >
                    <Trophy size={14} /> HIGH_SCORE: {highScore}
                  </div>

                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className="absolute top-6 right-6 hover:opacity-100 transition-opacity flex items-center gap-2 text-[10px] font-bold tracking-widest opacity-50"
                    style={{ color: currentTheme.uiText }}
                  >
                    {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    <span>{isMuted ? "[ AUDIO : MUTE ]" : "[ AUDIO : ON ]"}</span>
                  </button>

                  <div className="flex flex-col gap-4 md:gap-2 w-72 mb-6 md:mb-4">
                    <div
                      className="text-[10px] uppercase tracking-widest text-center mb-2 md:mb-1 font-bold select-none"
                      style={{ color: currentTheme.hudMuted }}
                    >
                      OS_THEME_SELECT:
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {(Object.keys(THEMES) as ThemeKey[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => {
                            setTheme(t);
                            playSound("click");
                          }}
                          className={`py-2 px-1 text-[10px] font-bold tracking-widest border transition-all ${
                            theme === t
                              ? "bg-opacity-10"
                              : "bg-transparent opacity-50"
                          }`}
                          style={{
                            borderColor:
                              theme === t
                                ? THEMES[t as ThemeKey].uiText
                                : currentTheme.gridBorder,
                            color:
                              theme === t
                                ? THEMES[t as ThemeKey].uiText
                                : currentTheme.hudMuted,
                            backgroundColor:
                              theme === t
                                ? `rgba(${THEMES[t as ThemeKey].snakeBase}, 0.1)`
                                : "transparent",
                          }}
                        >
                          [{t}]
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 md:gap-2 w-72 mb-6 md:mb-4">
                    <div
                      className="text-[10px] uppercase tracking-widest text-center mb-2 md:mb-1 font-bold select-none"
                      style={{ color: currentTheme.hudMuted }}
                    >
                      Execution_Protocol:
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setGameMode("CLASSIC");
                          playSound("click");
                        }}
                        className={`flex-1 px-2 py-2 text-xs font-bold tracking-widest border transition-all ${
                          gameMode === "CLASSIC"
                            ? "bg-opacity-10"
                            : "bg-transparent opacity-50"
                        }`}
                        style={{
                          borderColor:
                            gameMode === "CLASSIC"
                              ? currentTheme.uiText
                              : currentTheme.gridBorder,
                          color:
                            gameMode === "CLASSIC"
                              ? currentTheme.uiText
                              : currentTheme.hudMuted,
                          backgroundColor:
                            gameMode === "CLASSIC"
                              ? `rgba(${currentTheme.snakeBase}, 0.1)`
                              : "transparent",
                        }}
                      >
                        [CLASSIC]
                      </button>
                      <button
                        onClick={() => {
                          setGameMode("SIMULATION");
                          playSound("click");
                        }}
                        className={`flex-1 px-2 py-2 text-xs font-bold tracking-widest border transition-all ${
                          gameMode === "SIMULATION"
                            ? "bg-opacity-10"
                            : "bg-transparent opacity-50"
                        }`}
                        style={{
                          borderColor:
                            gameMode === "SIMULATION"
                              ? currentTheme.uiText
                              : currentTheme.gridBorder,
                          color:
                            gameMode === "SIMULATION"
                              ? currentTheme.uiText
                              : currentTheme.hudMuted,
                          backgroundColor:
                            gameMode === "SIMULATION"
                              ? `rgba(${currentTheme.snakeBase}, 0.1)`
                              : "transparent",
                        }}
                      >
                        [SIMULATION]
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 md:gap-2 w-72 mb-6 md:mb-4">
                    <div
                      className="text-[10px] uppercase tracking-widest text-center mb-2 md:mb-1 font-bold select-none"
                      style={{ color: currentTheme.hudMuted }}
                    >
                      Procedural_Seed (Optional):
                    </div>
                    <input
                      type="text"
                      maxLength={16}
                      value={seedInput}
                      onChange={(e) => setSeedInput(e.target.value)}
                      placeholder="RANDOM_GEN"
                      className="w-full bg-black border text-center py-2 text-xs font-bold tracking-[0.2em] focus:outline-none transition-colors uppercase"
                      style={{
                        borderColor: currentTheme.gridBorder,
                        color: currentTheme.uiText,
                      }}
                    />
                  </div>

                  <div className="flex flex-col gap-4 md:gap-2 w-72 mb-10 md:mb-6">
                    <div
                      className="text-[10px] uppercase tracking-widest text-center mb-2 md:mb-1 font-bold select-none"
                      style={{ color: currentTheme.hudMuted }}
                    >
                      Select_Difficulty_Protocol:
                    </div>
                    {(Object.keys(DIFFICULTY_CONFIG) as DifficultyLevel[]).map(
                      (level) => (
                        <button
                          key={level}
                          onClick={() => {
                            setDifficulty(level);
                            playSound("click");
                          }}
                          className={`px-4 py-3 text-xs font-bold tracking-widest border transition-all
                      ${difficulty === level ? "bg-opacity-10" : "bg-transparent opacity-50"}
                    `}
                          style={{
                            borderColor:
                              difficulty === level
                                ? currentTheme.uiText
                                : currentTheme.gridBorder,
                            color:
                              difficulty === level
                                ? currentTheme.uiText
                                : currentTheme.hudMuted,
                            backgroundColor:
                              difficulty === level
                                ? `rgba(${currentTheme.snakeBase}, 0.1)`
                                : "transparent",
                          }}
                        >
                          [{level}]
                        </button>
                      ),
                    )}
                  </div>

                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={startBootSequence}
                    className="group relative w-72 py-4 px-6 flex items-center justify-center font-bold tracking-[0.3em] overflow-hidden"
                    style={{
                      backgroundColor: currentTheme.uiText,
                      color: "black",
                    }}
                  >
                    <div className="absolute inset-0 bg-white/30 translate-y-full group-hover:translate-y-0 transition-transform" />
                    <span className="relative">PLAY_GAME</span>
                  </motion.button>

                  <div className="mt-8 md:mt-6 flex gap-6">
                    {localStorage.getItem("neon_snake_saved_state") && (
                      <button
                        onClick={loadGameState}
                        className="text-[10px] font-bold tracking-[0.2em] transition-opacity hover:opacity-100 opacity-60 flex items-center gap-2"
                        style={{ color: currentTheme.uiText }}
                      >
                        <RefreshCw size={12} /> RESTORE_SESSION
                      </button>
                    )}
                  </div>

                  <div
                    className="mt-10 md:mt-6 text-[10px] space-y-1 text-center font-bold"
                    style={{ color: currentTheme.hudMuted }}
                  >
                    <p>MAPPED_CONTROLS: [WASD] OR [ARROWS]</p>
                    <p>
                      STATUS:{" "}
                      {gameMode === "CLASSIC"
                        ? "BOUNDARIES_ENFORCED"
                        : "PORTAL_GATES_OPENED"}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {gameState === "PAUSED" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 backdrop-blur-md"
              >
                <div className="w-[95%] max-w-lg bg-gray-950 p-8 rounded-lg border border-pink-900 flex flex-col items-center shadow-[0_0_20px_rgba(255,0,128,0.1)]">
                  <div
                    className="text-2xl font-bold tracking-[0.5em] mb-8"
                    style={{ color: currentTheme.uiText }}
                  >
                    SYSTEM_PAUSED
                  </div>
                  <div className="flex flex-col sm:flex-row w-full justify-center gap-4 mb-8">
                    <button
                      onClick={() => setGameState("PLAYING")}
                      className="px-6 py-2 border font-bold tracking-widest transition-colors flex items-center justify-center w-full sm:w-auto gap-2 whitespace-nowrap"
                      style={{
                        borderColor: currentTheme.uiText,
                        color: currentTheme.uiText,
                        backgroundColor: "transparent",
                      }}
                    >
                      <Play size={16} /> RESUME
                    </button>
                    <button
                      onClick={saveGameState}
                      className="px-6 py-2 border font-bold tracking-widest transition-opacity hover:opacity-100 opacity-60 flex items-center justify-center w-full sm:w-auto gap-2 whitespace-nowrap"
                      style={{
                        borderColor: currentTheme.gridBorder,
                        color: currentTheme.uiText,
                      }}
                    >
                      <RefreshCw size={16} /> {saveStateText}
                    </button>
                  </div>

                  <button
                    onClick={() => {
                      const keys = Object.keys(THEMES) as ThemeKey[];
                      const nextIndex = (keys.indexOf(theme) + 1) % keys.length;
                      setTheme(keys[nextIndex]);
                      playSound("click");
                    }}
                    className="px-6 py-2 border font-bold tracking-widest transition-opacity hover:opacity-100 flex items-center gap-2 mw-48 justify-center"
                    style={{
                      borderColor: currentTheme.uiText,
                      color: currentTheme.uiText,
                    }}
                  >
                    THEME: {currentTheme.name}
                  </button>

                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className="mt-4 px-6 py-2 border font-bold tracking-widest transition-opacity hover:opacity-100 flex items-center gap-2 mw-48 justify-center opacity-60 hover:opacity-100"
                    style={{
                      borderColor: currentTheme.gridBorder,
                      color: currentTheme.uiText,
                    }}
                  >
                    {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                    {isMuted ? "[ AUDIO : MUTE ]" : "[ AUDIO : ON ]"}
                  </button>

                  <button
                    onClick={() => {
                      playSound("returnHome");
                      setGameState("START");
                    }}
                    className="mt-6 px-6 py-2 text-xs border font-bold tracking-[0.2em] transition-opacity hover:bg-opacity-20 flex items-center gap-2 text-red-500 border-red-500/50 hover:bg-red-500/10"
                  >
                    [RETURN_TO_ROOT]
                  </button>
                </div>
              </motion.div>
            )}

            {gameState === "PLAYING" && isRespawning && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 1.2, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
              >
                <div
                  className="text-4xl font-bold tracking-[0.5em] uppercase"
                  style={{
                    color: currentTheme.uiText,
                    textShadow: `0 0 20px ${currentTheme.uiText}`,
                  }}
                >
                  GET READY
                </div>
              </motion.div>
            )}

            {gameState === "GAME_OVER" && (
              <motion.div
                initial={{ scaleY: 0.01, opacity: 0 }}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4"
              >
                <div className="text-5xl md:text-6xl font-bold tracking-[0.2em] mb-8 text-red-500 drop-shadow-[0_0_8px_rgba(255,0,0,0.8)] z-10 py-4 leading-tight">
                  GAME OVER
                </div>

                <div className="flex flex-col items-center justify-center p-8 w-[90%] max-w-md h-auto min-h-fit gap-6 border border-cyan-900 bg-gray-950 rounded-lg shadow-[0_0_20px_rgba(0,255,255,0.1)] relative z-10 text-center">
                  <div className="absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(rgba(255,255,255,0)_50%,rgba(0,0,0,1)_50%)] bg-[length:100%_4px] rounded-lg" />

                  <div className="w-full flex gap-4 font-mono z-10">
                    <div className="flex flex-col items-center justify-center flex-1 border border-cyan-900/50 p-4 bg-black/50 rounded">
                      <span
                        className="text-[10px] tracking-widest font-bold mb-2 uppercase"
                        style={{ color: currentTheme.hudMuted }}
                      >
                        SCORE
                      </span>
                      <span
                        className="text-3xl font-bold"
                        style={{ color: currentTheme.uiText }}
                      >
                        {score}
                      </span>
                    </div>
                    <div className="flex flex-col items-center justify-center flex-1 border border-cyan-900/50 p-4 bg-black/50 rounded">
                      <span
                        className="text-[10px] tracking-widest font-bold mb-2 uppercase"
                        style={{ color: currentTheme.hudMuted }}
                      >
                        PERSONAL BEST
                      </span>
                      <span
                        className="text-3xl font-bold"
                        style={{ color: currentTheme.particleBase }}
                      >
                        {Math.max(score, highScore)}
                      </span>
                    </div>
                  </div>

                  <div className="w-full flex flex-col gap-3 mt-4 z-10">
                    <button
                      onClick={() => {
                        playSound("click");
                        resetGame();
                      }}
                      className="w-full py-4 font-bold tracking-[0.3em] transition-all border outline-none duration-200 bg-gray-950 hover:bg-cyan-950 text-cyan-400 border-cyan-500 hover:border-cyan-300 hover:shadow-[0_0_15px_rgba(0,255,255,0.4)] rounded"
                    >
                      PLAY AGAIN
                    </button>
                    <button
                      onClick={() => {
                        playSound("returnHome");
                        setGameState("START");
                      }}
                      className="w-full py-3 font-bold tracking-[0.2em] transition-all border outline-none bg-gray-950 hover:bg-red-950 text-red-500 border-red-900 hover:border-red-500 hover:text-red-400 hover:shadow-[0_0_15px_rgba(255,0,0,0.3)] rounded text-xs"
                    >
                      MAIN MENU
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Mobile D-Pad */}
        {gameState === "PLAYING" && (
          <div className="md:hidden grid grid-cols-3 gap-4 p-6 select-none touch-none z-30 opacity-90 mt-4 mb-2">
            <div />
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                handleDirectionChange({ x: 0, y: -1 });
              }}
              className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center border-2 text-2xl font-bold bg-gray-900/60 backdrop-blur-sm active:scale-90 active:bg-white active:text-black transition-all duration-75"
              style={{
                color: currentTheme.uiText,
                borderColor: currentTheme.gridBorder,
                boxShadow: `0 0 15px rgba(${currentTheme.snakeBase}, 0.2)`,
              }}
            >
              ^
            </button>
            <div />

            <button
              onPointerDown={(e) => {
                e.preventDefault();
                handleDirectionChange({ x: -1, y: 0 });
              }}
              className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center border-2 text-2xl font-bold bg-gray-900/60 backdrop-blur-sm active:scale-90 active:bg-white active:text-black transition-all duration-75"
              style={{
                color: currentTheme.uiText,
                borderColor: currentTheme.gridBorder,
                boxShadow: `0 0 15px rgba(${currentTheme.snakeBase}, 0.2)`,
              }}
            >
              &lt;
            </button>
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                handleDirectionChange({ x: 0, y: 1 });
              }}
              className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center border-2 text-2xl font-bold bg-gray-900/60 backdrop-blur-sm active:scale-90 active:bg-white active:text-black transition-all duration-75"
              style={{
                color: currentTheme.uiText,
                borderColor: currentTheme.gridBorder,
                boxShadow: `0 0 15px rgba(${currentTheme.snakeBase}, 0.2)`,
              }}
            >
              v
            </button>
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                handleDirectionChange({ x: 1, y: 0 });
              }}
              className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center border-2 text-2xl font-bold bg-gray-900/60 backdrop-blur-sm active:scale-90 active:bg-white active:text-black transition-all duration-75"
              style={{
                color: currentTheme.uiText,
                borderColor: currentTheme.gridBorder,
                boxShadow: `0 0 15px rgba(${currentTheme.snakeBase}, 0.2)`,
              }}
            >
              &gt;
            </button>
          </div>
        )}

        {/* Additional UI Actions for Mobile */}
        {gameState === "PLAYING" && (
          <button
            onPointerDown={() => {
              playSound("pauseGame");
              setGameState("PAUSED");
            }}
            className="md:hidden mt-2 px-8 py-3 rounded-full border text-xs tracking-widest font-bold bg-gray-900/60 backdrop-blur-sm active:scale-95 transition-all duration-75"
            style={{
              borderColor: currentTheme.gridBorder,
              color: currentTheme.uiText,
              boxShadow: `0 0 10px rgba(${currentTheme.snakeBase}, 0.1)`,
            }}
          >
            [PAUSE_SESSION]
          </button>
        )}
        
        {/* Sponsored Transmission Native Ad Container */}
        <div className="w-full mt-6 flex flex-col items-center">
          <div className="w-full max-w-[min(95vw,75vh)] border rounded-lg bg-gray-950 shadow-[0_0_15px_rgba(0,0,0,0.5)] overflow-hidden relative"
               style={{ borderColor: currentTheme.gridBorder }}>
            <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(rgba(255,255,255,0)_50%,rgba(0,0,0,1)_50%)] bg-[length:100%_4px]"></div>
            <div className="w-full px-4 py-2 border-b text-[10px] tracking-widest font-bold flex items-center justify-between"
                 style={{ borderColor: currentTheme.gridBorder, color: currentTheme.hudMuted, backgroundColor: 'rgba(0,0,0,0.4)' }}>
              <span>&gt;&gt; SPONSORED TRANSMISSION &lt;&lt;</span>
              <span className="animate-pulse" style={{ color: currentTheme.particleBase }}>●</span>
            </div>
            <div className="p-4 flex justify-center items-center min-h-[100px] relative z-10 w-full overflow-hidden">
              <div id="container-f7097529b288f28b614ef304a5ec1bec" className="w-full flex justify-center">
                <span id="ad-fallback-message" className="animate-pulse" style={{ fontFamily: "'JetBrains Mono', monospace", color: "rgba(255, 60, 60, 0.8)", fontSize: "10px", textAlign: "center", letterSpacing: "0.1em" }}>
                  [ SIGNAL INTERFERENCE: PLEASE DISABLE AD-BLOCKER TO SUPPORT THE POOR DEVELOPER ]
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SnakeGame;
