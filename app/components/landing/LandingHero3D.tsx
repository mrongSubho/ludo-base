"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { prefersReducedMotion, onReducedMotionChange } from '@/lib/motion';
import { SHARED_PATH } from '@/lib/boardLayout';

interface LandingHero3DProps {
  theme?: string;
  tokenStyle?: 'orb' | 'chess';
  onDiceRollResult?: (value: number) => void;
}

type CameraPreset = 'tactical' | 'synergy' | 'radar';

export default function LandingHero3D({
  theme: _theme = '3077',
  tokenStyle = 'orb',
  onDiceRollResult,
}: LandingHero3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [lastRoll, setLastRoll] = useState<number | null>(6);
  const [activePreset, setActivePreset] = useState<CameraPreset>('tactical');
  const [proofHash, setProofHash] = useState('0x7f9a2e8c1b4d3f5a60e712398b7a64c5d2e1f0a9');

  // References for animation loop & disposal
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const diceMeshRef = useRef<THREE.Mesh | null>(null);
  const pawnsRef = useRef<THREE.Group[]>([]);
  const synergyLinesRef = useRef<THREE.Line[]>([]);
  const isVisibleRef = useRef(true);
  const reducedMotionRef = useRef(false);

  // Pawn positions on the 52-tile perimeter path
  const pawnProgressRef = useRef<number[]>([34, 8, 21, 47]); // Green(BL), Blue(TR), Red(BR), Yellow(TL)
  const isAnimatingMoveRef = useRef(false);

  // Initialize and run Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    reducedMotionRef.current = prefersReducedMotion();
    const unsubMotion = onReducedMotionChange((reduced) => {
      reducedMotionRef.current = reduced;
    });

    // 1. Scene, Camera, Renderer
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 500;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 16, 17);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 2. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0x00e5ff, 2.2);
    keyLight.position.set(8, 18, 12);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0xffaa00, 1.4, 25);
    rimLight.position.set(-10, 6, -10);
    scene.add(rimLight);

    // 3. Board Chassis Slab
    const chassisGeo = new THREE.BoxGeometry(16, 0.6, 16);
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x090d14,
      metalness: 0.88,
      roughness: 0.22,
    });
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.y = -0.3;
    chassis.receiveShadow = true;
    scene.add(chassis);

    // Glowing Chassis Rim
    const rimGeo = new THREE.EdgesGeometry(chassisGeo);
    const rimMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2 });
    const rimLine = new THREE.LineSegments(rimGeo, rimMat);
    rimLine.position.y = -0.3;
    scene.add(rimLine);

    // 4. Instanced 15x15 Tile Grid (Single Draw Call)
    const TILE_COUNT = 225;
    const tileGeo = new THREE.BoxGeometry(0.88, 0.1, 0.88);
    const tileMat = new THREE.MeshStandardMaterial({
      metalness: 0.65,
      roughness: 0.35,
    });
    const instancedTiles = new THREE.InstancedMesh(tileGeo, tileMat, TILE_COUNT);
    instancedTiles.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const colorWhite = new THREE.Color(0x1a2333);
    const colorSafe = new THREE.Color(0xf59e0b);
    const colorGreen = new THREE.Color(0x00ff66);
    const colorBlue = new THREE.Color(0x0099ff);
    const colorRed = new THREE.Color(0xff0055);
    const colorYellow = new THREE.Color(0xffd000);

    let index = 0;
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const posX = (c - 7) * 0.96;
        const posZ = (r - 7) * 0.96;
        dummy.position.set(posX, 0.05, posZ);
        dummy.updateMatrix();
        instancedTiles.setMatrixAt(index, dummy.matrix);

        // Tile Coloring by Zone
        if (
          (r === 6 && c === 1) || (r === 1 && c === 8) ||
          (r === 8 && c === 13) || (r === 13 && c === 6)
        ) {
          instancedTiles.setColorAt(index, colorSafe);
        } else if (r >= 9 && c <= 5) {
          instancedTiles.setColorAt(index, colorGreen);
        } else if (r <= 5 && c >= 9) {
          instancedTiles.setColorAt(index, colorBlue);
        } else if (r >= 9 && c >= 9) {
          instancedTiles.setColorAt(index, colorRed);
        } else if (r <= 5 && c <= 5) {
          instancedTiles.setColorAt(index, colorYellow);
        } else if (r === 7 && c >= 1 && c <= 6) {
          instancedTiles.setColorAt(index, colorGreen);
        } else if (c === 7 && r >= 1 && r <= 5) {
          instancedTiles.setColorAt(index, colorBlue);
        } else if (r === 7 && c >= 8 && c <= 13) {
          instancedTiles.setColorAt(index, colorRed);
        } else if (c === 7 && r >= 9 && r <= 13) {
          instancedTiles.setColorAt(index, colorYellow);
        } else {
          instancedTiles.setColorAt(index, colorWhite);
        }
        index++;
      }
    }
    instancedTiles.instanceMatrix.needsUpdate = true;
    if (instancedTiles.instanceColor) instancedTiles.instanceColor.needsUpdate = true;
    scene.add(instancedTiles);

    // 5. Center Core Finish Hexagon
    const coreGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.22, 6);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff,
      emissive: 0x004466,
      metalness: 0.9,
      roughness: 0.1,
    });
    const coreHex = new THREE.Mesh(coreGeo, coreMat);
    coreHex.position.y = 0.12;
    scene.add(coreHex);

    // 6. Interactive 3D Dice (Center Stage)
    const diceGeo = new THREE.BoxGeometry(0.85, 0.85, 0.85);
    const diceMat = new THREE.MeshStandardMaterial({
      color: 0x07090e,
      emissive: 0x003344,
      metalness: 0.95,
      roughness: 0.15,
    });
    const diceMesh = new THREE.Mesh(diceGeo, diceMat);
    diceMesh.position.set(0, 1.8, 0);
    diceMesh.castShadow = true;
    scene.add(diceMesh);
    diceMeshRef.current = diceMesh;

    const diceEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(diceGeo),
      new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2 })
    );
    diceMesh.add(diceEdges);

    // 7. Pawns (4 Colors: Green, Blue, Red, Yellow)
    const pawnColors = [0x00ff66, 0x0099ff, 0xff0055, 0xffd000];
    const pawns: THREE.Group[] = [];

    pawnColors.forEach((hex, i) => {
      const group = new THREE.Group();
      if (tokenStyle === 'chess') {
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.42, 0.2, 16),
          new THREE.MeshStandardMaterial({ color: hex, metalness: 0.8, roughness: 0.2 })
        );
        const stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.18, 0.28, 0.5, 16),
          new THREE.MeshStandardMaterial({ color: hex, metalness: 0.7, roughness: 0.3 })
        );
        stem.position.y = 0.35;
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.24, 16, 16),
          new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.4 })
        );
        head.position.y = 0.7;
        group.add(base, stem, head);
      } else {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.36, 24, 24),
          new THREE.MeshStandardMaterial({
            color: hex,
            emissive: hex,
            emissiveIntensity: 0.6,
            metalness: 0.9,
            roughness: 0.1,
          })
        );
        sphere.position.y = 0.42;

        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.5, 0.04, 8, 24),
          new THREE.MeshBasicMaterial({ color: hex })
        );
        ring.position.y = 0.42;
        ring.rotation.x = Math.PI / 2.4;
        group.add(sphere, ring);
      }

      const startPathIndex = pawnProgressRef.current[i];
      const point = SHARED_PATH[startPathIndex] || { r: 8, c: 8 };
      group.position.set((point.c - 8) * 0.96, 0.1, (point.r - 8) * 0.96);
      scene.add(group);
      pawns.push(group);
    });
    pawnsRef.current = pawns;

    // 8. 2v2 Synergy Laser Beams
    const lineMatA = new THREE.LineBasicMaterial({ color: 0x00e5ff, linewidth: 2, transparent: true, opacity: 0 });
    const lineGeoA = new THREE.BufferGeometry().setFromPoints([pawns[0].position, pawns[1].position]);
    const lineA = new THREE.Line(lineGeoA, lineMatA);
    scene.add(lineA);

    const lineMatB = new THREE.LineBasicMaterial({ color: 0xffaa00, linewidth: 2, transparent: true, opacity: 0 });
    const lineGeoB = new THREE.BufferGeometry().setFromPoints([pawns[2].position, pawns[3].position]);
    const lineB = new THREE.Line(lineGeoB, lineMatB);
    scene.add(lineB);

    synergyLinesRef.current = [lineA, lineB];

    // 9. Resize Handling
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // 10. Viewport Visibility Guard
    const observer = new IntersectionObserver(([entry]) => {
      isVisibleRef.current = entry.isIntersecting;
    });
    observer.observe(container);

    // 11. Mouse Tilt Parallax
    let targetRotY = 0;
    let targetRotX = 0;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      targetRotY = x * 0.25;
      targetRotX = y * 0.15;
    };
    container.addEventListener('mousemove', handleMouseMove);

    // 12. Main 60 FPS Render Loop
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (!isVisibleRef.current) return;
      clock.getDelta();
      const time = clock.getElapsedTime();

      chassis.rotation.y += (targetRotY - chassis.rotation.y) * 0.05;
      chassis.rotation.x += (targetRotX - chassis.rotation.x) * 0.05;
      instancedTiles.rotation.y = chassis.rotation.y;
      instancedTiles.rotation.x = chassis.rotation.x;

      if (diceMesh && !reducedMotionRef.current) {
        diceMesh.position.y = 1.8 + Math.sin(time * 2.5) * 0.12;
        diceMesh.rotation.y += 0.008;
      }

      pawns.forEach((p, idx) => {
        if (!reducedMotionRef.current && !isAnimatingMoveRef.current) {
          p.position.y = 0.1 + Math.sin(time * 3 + idx) * 0.06;
        }
      });

      if (lineA && pawns[0] && pawns[1]) {
        lineA.geometry.setFromPoints([
          new THREE.Vector3(pawns[0].position.x, pawns[0].position.y + 0.4, pawns[0].position.z),
          new THREE.Vector3(pawns[1].position.x, pawns[1].position.y + 0.4, pawns[1].position.z),
        ]);
      }
      if (lineB && pawns[2] && pawns[3]) {
        lineB.geometry.setFromPoints([
          new THREE.Vector3(pawns[2].position.x, pawns[2].position.y + 0.4, pawns[2].position.z),
          new THREE.Vector3(pawns[3].position.x, pawns[3].position.y + 0.4, pawns[3].position.z),
        ]);
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      unsubMotion();
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousemove', handleMouseMove);
      observer.disconnect();
      cancelAnimationFrame(animationFrameId);

      chassisGeo.dispose();
      chassisMat.dispose();
      tileGeo.dispose();
      tileMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      diceGeo.dispose();
      diceMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (container) container.innerHTML = '';
    };
  }, [tokenStyle]);

  const applyPreset = useCallback((preset: CameraPreset) => {
    setActivePreset(preset);
    const cam = cameraRef.current;
    if (!cam) return;

    if (preset === 'tactical') {
      cam.position.set(0, 16, 17);
      cam.lookAt(0, 0, 0);
      synergyLinesRef.current.forEach((l) => (l.material as THREE.LineBasicMaterial).opacity = 0);
    } else if (preset === 'synergy') {
      cam.position.set(10, 14, 14);
      cam.lookAt(0, 0, 0);
      synergyLinesRef.current.forEach((l) => (l.material as THREE.LineBasicMaterial).opacity = 0.85);
    } else if (preset === 'radar') {
      cam.position.set(0, 22, 4);
      cam.lookAt(0, 0, 0);
      synergyLinesRef.current.forEach((l) => (l.material as THREE.LineBasicMaterial).opacity = 0);
    }
  }, []);

  const handleRollClick = useCallback(() => {
    if (isRolling) return;
    setIsRolling(true);

    const rollValue = Math.floor(Math.random() * 6) + 1;
    setLastRoll(rollValue);

    const randomHex = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    setProofHash(`0x${randomHex}`);

    const dice = diceMeshRef.current;
    if (dice) {
      const startRotX = dice.rotation.x;
      const startRotY = dice.rotation.y;
      const startRotZ = dice.rotation.z;
      const extraSpins = 4 * Math.PI;

      let elapsed = 0;
      const duration = reducedMotionRef.current ? 0.2 : 0.8;

      const tumbleInterval = setInterval(() => {
        elapsed += 0.03;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);

        dice.rotation.x = startRotX + extraSpins * ease;
        dice.rotation.y = startRotY + extraSpins * 1.5 * ease;
        dice.rotation.z = startRotZ + extraSpins * 0.7 * ease;

        if (progress >= 1) {
          clearInterval(tumbleInterval);
          setIsRolling(false);
          onDiceRollResult?.(rollValue);

          const pawn0 = pawnsRef.current[0];
          if (pawn0 && !reducedMotionRef.current) {
            isAnimatingMoveRef.current = true;
            const currentIdx = pawnProgressRef.current[0];
            const nextIdx = (currentIdx + rollValue) % SHARED_PATH.length;
            pawnProgressRef.current[0] = nextIdx;

            const targetPoint = SHARED_PATH[nextIdx] || { r: 8, c: 8 };
            const targetX = (targetPoint.c - 8) * 0.96;
            const targetZ = (targetPoint.r - 8) * 0.96;

            const startX = pawn0.position.x;
            const startZ = pawn0.position.z;
            let hopTime = 0;

            const hopInterval = setInterval(() => {
              hopTime += 0.04;
              const p = Math.min(hopTime / 0.6, 1);
              pawn0.position.x = startX + (targetX - startX) * p;
              pawn0.position.z = startZ + (targetZ - startZ) * p;
              pawn0.position.y = 0.1 + 4 * 1.2 * p * (1 - p);

              if (p >= 1) {
                clearInterval(hopInterval);
                isAnimatingMoveRef.current = false;
                pawn0.position.y = 0.1;
              }
            }, 30);
          }
        }
      }, 30);
    }
  }, [isRolling, onDiceRollResult]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
        e.preventDefault();
        handleRollClick();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRollClick]);

  return (
    <div className="relative w-full h-full min-h-[460px] flex flex-col items-center justify-center">
      <div ref={containerRef} className="landing-canvas-host w-full h-full" />

      <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none text-ludo-xs">
        <div className="flex items-center gap-2 bg-surface-panel/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-line-soft">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          <span className="font-semibold tracking-wider uppercase text-ink-strong">
            Three.js WebGL Arena
          </span>
          <span className="text-ink-faint">|</span>
          <span className="text-ink-muted">60 FPS</span>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 bg-surface-panel/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-line-soft font-mono text-ink-faint">
          <span>COMMIT:</span>
          <span className="text-accent">{proofHash.slice(0, 10)}…{proofHash.slice(-6)}</span>
        </div>
      </div>

      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
        <div className="flex items-center gap-1 bg-surface-panel/90 backdrop-blur-md p-1 rounded-xl border border-line-soft">
          <button
            type="button"
            onClick={() => applyPreset('tactical')}
            className={`px-2.5 py-1 rounded-lg text-ludo-xs uppercase tracking-wider font-bold transition-all ${
              activePreset === 'tactical'
                ? 'bg-accent text-surface-page shadow-sm'
                : 'text-ink-muted hover:text-ink-strong'
            }`}
          >
            Tactical
          </button>
          <button
            type="button"
            onClick={() => applyPreset('synergy')}
            className={`px-2.5 py-1 rounded-lg text-ludo-xs uppercase tracking-wider font-bold transition-all ${
              activePreset === 'synergy'
                ? 'bg-accent text-surface-page shadow-sm'
                : 'text-ink-muted hover:text-ink-strong'
            }`}
          >
            2v2 Synergy
          </button>
          <button
            type="button"
            onClick={() => applyPreset('radar')}
            className={`px-2.5 py-1 rounded-lg text-ludo-xs uppercase tracking-wider font-bold transition-all ${
              activePreset === 'radar'
                ? 'bg-accent text-surface-page shadow-sm'
                : 'text-ink-muted hover:text-ink-strong'
            }`}
          >
            Radar Top
          </button>
        </div>

        <button
          type="button"
          onClick={handleRollClick}
          disabled={isRolling}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-ludo-sm uppercase font-black label-chrome tracking-widest bg-accent hover:brightness-110 active:scale-95 text-surface-page transition-all shadow-[0_0_20px_rgba(0,229,255,0.35)] disabled:opacity-50"
        >
          <span>🎲</span>
          <span>{isRolling ? 'ROLLING…' : 'ROLL 3D DICE'}</span>
          <span className="hidden md:inline px-1.5 py-0.5 rounded text-ludo-xs bg-surface-page/20 font-mono">
            SPACE
          </span>
          {lastRoll !== null && (
            <span className="w-5 h-5 rounded-md bg-surface-page text-accent flex items-center justify-center font-mono font-bold text-xs ml-1">
              {lastRoll}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
