import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type {
  CornerHardpoints3D,
  TelemetryFrame,
  VehicleOverviewResponse,
} from "../../types";
import { hasNonZeroHardpoints } from "../../services/apiClient";
import { useTelemetryStore } from "../../state/telemetryStore";
import { SplitPane } from "../layout/SplitPane";
import {
  KinematicsLayerToggles,
  SuspensionKinematicsOverlay,
} from "./SuspensionKinematicsOverlay";

type CameraPresetId = "ISO" | "FRONT" | "REAR" | "TOP" | "SIDE" | "FL_CORNER";

const CAMERA_PRESETS: Record<
  CameraPresetId,
  { pos: [number, number, number]; target: [number, number, number] }
> = {
  ISO: { pos: [2.25, 1.35, 1.95], target: [0.0, 0.28, 0.0] },
  FRONT: { pos: [2.5, 0.42, 0.0], target: [0.2, 0.25, 0.0] },
  REAR: { pos: [-2.5, 0.48, 0.0], target: [-0.2, 0.25, 0.0] },
  TOP: { pos: [0.01, 3.2, 0.01], target: [0.0, 0.15, 0.0] },
  SIDE: { pos: [0.0, 0.52, 2.75], target: [0.0, 0.28, 0.0] },
  FL_CORNER: { pos: [1.55, 0.56, -1.28], target: [0.74, 0.22, -0.52] },
};

const isSoftwareGl = (() => {
  if (typeof document === "undefined") return false;
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) return true;
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
})();

/**
 * ISO 8855 (+X forward, +Y left, +Z up) -> Three.js right-handed (+X forward, +Y up, -Z left)
 */
function isoToThree(p: number[], mirrorRight = false): [number, number, number] {
  const yIso = mirrorRight ? -p[1] : p[1];
  return [p[0], p[2], -yIso];
}

function StudioEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    pmrem.dispose();
    return () => {
      env.dispose();
      scene.environment = null;
    };
  }, [gl, scene]);
  return null;
}

function CameraRig({
  preset,
  presetTrigger,
}: {
  preset: CameraPresetId;
  presetTrigger: number;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const transitioningRef = useRef<boolean>(false);
  const targetPos = useMemo(() => new THREE.Vector3(), []);
  const targetLook = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const spec = CAMERA_PRESETS[preset];
    targetPos.set(...spec.pos);
    targetLook.set(...spec.target);
    transitioningRef.current = true;
  }, [preset, presetTrigger, targetLook, targetPos]);

  useFrame((_, delta) => {
    if (!transitioningRef.current || !controlsRef.current) return;
    const dt = Math.min(delta, 0.05);
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetPos.x, 7, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetPos.y, 7, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, targetPos.z, 7, dt);

    controlsRef.current.target.x = THREE.MathUtils.damp(
      controlsRef.current.target.x,
      targetLook.x,
      7,
      dt
    );
    controlsRef.current.target.y = THREE.MathUtils.damp(
      controlsRef.current.target.y,
      targetLook.y,
      7,
      dt
    );
    controlsRef.current.target.z = THREE.MathUtils.damp(
      controlsRef.current.target.z,
      targetLook.z,
      7,
      dt
    );
    controlsRef.current.update();

    if (
      camera.position.distanceTo(targetPos) < 0.01 &&
      controlsRef.current.target.distanceTo(targetLook) < 0.01
    ) {
      transitioningRef.current = false;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping={!isSoftwareGl}
      dampingFactor={0.08}
      minDistance={0.65}
      maxDistance={8.5}
      maxPolarAngle={Math.PI * 0.49}
      onStart={() => {
        transitioningRef.current = false;
      }}
    />
  );
}

/**
 * Calibrated 0.5 m engineering reference floor grid
 */
function FloorMeasurementGrid() {
  const lines = useMemo(() => {
    const minor: Array<[[number, number, number], [number, number, number]]> = [];
    const major: Array<[[number, number, number], [number, number, number]]> = [];
    const extent = 4.0;
    for (let v = -extent; v <= extent + 1e-4; v += 0.5) {
      const isMajor = Math.abs(v - Math.round(v)) < 1e-3;
      const target = isMajor ? major : minor;
      target.push([
        [v, 0.001, -extent],
        [v, 0.001, extent],
      ]);
      target.push([
        [-extent, 0.001, v],
        [extent, 0.001, v],
      ]);
    }
    return { minor, major };
  }, []);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color="#090B10" roughness={0.95} metalness={0.05} />
      </mesh>
      {lines.minor.map((seg, i) => (
        <Line key={`m-${i}`} points={seg} color="#171B26" lineWidth={0.75} />
      ))}
      {lines.major.map((seg, i) => (
        <Line key={`M-${i}`} points={seg} color="#242A3A" lineWidth={1.1} />
      ))}
      {/* ISO 8855 Origin Axes (+X forward red, +Y left green -> -Z three, +Z up blue -> +Y three) */}
      <Line points={[[0, 0.005, 0], [0.45, 0.005, 0]]} color="#DC2626" lineWidth={1.6} />
      <Line points={[[0, 0.005, 0], [0, 0.005, -0.45]]} color="#10B981" lineWidth={1.6} />
      <Line points={[[0, 0.005, 0], [0, 0.45, 0]]} color="#38BDF8" lineWidth={1.6} />
    </group>
  );
}

function RodMember({
  a,
  b,
  radius = 0.007,
  color = "#9BA3B5",
}: {
  a: [number, number, number];
  b: [number, number, number];
  radius?: number;
  color?: string;
}) {
  const { mid, quat, len } = useMemo(() => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const diff = vb.clone().sub(va);
    const length = diff.length();
    const midpoint = va.clone().add(vb).multiplyScalar(0.5);
    const q = new THREE.Quaternion();
    if (length > 1e-5) {
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), diff.normalize());
    }
    return { mid: midpoint, quat: q, len: length };
  }, [a, b]);

  if (len < 1e-4) return null;

  return (
    <mesh position={mid} quaternion={quat}>
      <cylinderGeometry args={[radius, radius, len, 8]} />
      <meshStandardMaterial color={color} metalness={0.78} roughness={0.28} />
    </mesh>
  );
}

function CornerSuspensionLinkage({
  corner,
  mirrorRight,
  wheelTravelM,
}: {
  corner: CornerHardpoints3D;
  mirrorRight: boolean;
  wheelTravelM: number;
}) {
  if (!hasNonZeroHardpoints(corner)) return null;

  const p = (v: number[], dz = 0): [number, number, number] => {
    const shifted = [v[0], v[1], v[2] + dz];
    return isoToThree(shifted, mirrorRight);
  };

  const lcaF = p(corner.lca_front);
  const lcaR = p(corner.lca_rear);
  const lbj = p(corner.lbj, wheelTravelM);
  const ucaF = p(corner.uca_front);
  const ucaR = p(corner.uca_rear);
  const ubj = p(corner.ubj, wheelTravelM);
  const prW = p(corner.pushrod_wishbone, wheelTravelM * 0.85);
  const prR = p(corner.pushrod_rocker);
  const tieIn = p(corner.tie_inner);
  const tieOut = p(corner.tie_outer, wheelTravelM);
  const dampC = p(corner.damper_chassis);
  const dampR = p(corner.damper_rocker);
  const arbR = p(corner.arb_link_rocker);
  const arbTip = p(corner.arb_arm_tip);
  const arbPiv = p(corner.arb_chassis_piv);

  return (
    <group>
      {/* Lower Wishbone */}
      <RodMember a={lcaF} b={lbj} radius={0.008} color="#9CA3AF" />
      <RodMember a={lcaR} b={lbj} radius={0.008} color="#9CA3AF" />
      {/* Upper Wishbone */}
      <RodMember a={ucaF} b={ubj} radius={0.007} color="#9CA3AF" />
      <RodMember a={ucaR} b={ubj} radius={0.007} color="#9CA3AF" />
      {/* Upright Kingpin Spine */}
      <RodMember a={lbj} b={ubj} radius={0.011} color="#C5A059" />
      {/* Pushrod */}
      <RodMember a={prW} b={prR} radius={0.006} color="#C5A059" />
      {/* Tie Rod */}
      <RodMember a={tieIn} b={tieOut} radius={0.005} color="#38BDF8" />
      {/* Damper & ARB */}
      <RodMember a={dampC} b={dampR} radius={0.014} color="#D97706" />
      <RodMember a={arbR} b={arbTip} radius={0.005} color="#64748B" />
      <RodMember a={arbTip} b={arbPiv} radius={0.006} color="#64748B" />
    </group>
  );
}

function CompositeWheelAssembly({
  position,
  radiusM,
  widthM,
  steerRad,
  camberRad,
  isLeft,
  spinAngleRef,
}: {
  position: [number, number, number];
  radiusM: number;
  widthM: number;
  steerRad: number;
  camberRad: number;
  isLeft: boolean;
  spinAngleRef: React.MutableRefObject<number>;
}) {
  const wheelSpinRef = useRef<THREE.Group | null>(null);

  useFrame(() => {
    if (wheelSpinRef.current) {
      wheelSpinRef.current.rotation.z = -spinAngleRef.current;
    }
  });

  // Positive camber tilts top outward; invert for left vs right side in Three.js
  const rollCamber = isLeft ? camberRad : -camberRad;

  return (
    <group position={position} rotation={[0, steerRad, 0]}>
      <group rotation={[rollCamber, 0, 0]}>
        {/* Upright & In-Wheel Motor Housing (non-spinning) */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[radiusM * 0.42, radiusM * 0.42, widthM * 0.55, 16]} />
          <meshStandardMaterial color="#1E222E" metalness={0.82} roughness={0.26} />
        </mesh>
        {/* Brake Caliper */}
        <mesh position={[-radiusM * 0.36, 0.02, 0]}>
          <boxGeometry args={[0.055, 0.085, 0.06]} />
          <meshStandardMaterial color="#C5A059" metalness={0.75} roughness={0.3} />
        </mesh>

        {/* Spinning Tire + Rim + Center-Lock Nut */}
        <group ref={wheelSpinRef}>
          {/* Hoosier 16.0x7.5-10 Tire Carcass */}
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow={!isSoftwareGl}>
            <cylinderGeometry args={[radiusM, radiusM, widthM, 28]} />
            <meshStandardMaterial color="#14161B" roughness={0.86} metalness={0.06} />
          </mesh>
          {/* Rim Barrel */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[radiusM * 0.62, radiusM * 0.62, widthM + 0.004, 20]} />
            <meshStandardMaterial color="#272D3D" metalness={0.85} roughness={0.22} />
          </mesh>
          {/* Center-Lock Hub */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.032, 0.032, widthM + 0.016, 6]} />
            <meshStandardMaterial color="#C5A059" metalness={0.92} roughness={0.18} />
          </mesh>
          {/* Visual Rotation Spoke Bars */}
          {[0, Math.PI / 3, (2 * Math.PI) / 3].map((ang, i) => (
            <mesh
              key={i}
              rotation={[0, 0, ang]}
              position={[0, 0, isLeft ? -widthM * 0.42 : widthM * 0.42]}
            >
              <boxGeometry args={[radiusM * 1.12, 0.014, 0.012]} />
              <meshStandardMaterial color="#3A4259" metalness={0.85} roughness={0.25} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

function ForceVectorsAndRing({
  contactPos,
  fxN,
  fyN,
  fzN,
  util,
  showVectors,
  showRings,
}: {
  contactPos: [number, number, number];
  fxN: number;
  fyN: number;
  fzN: number;
  util: number;
  showVectors: boolean;
  showRings: boolean;
}) {
  const forceScale = 0.00032; // 1000 N -> 0.32 m
  const ringRadius = Math.max(0.08, Math.min(0.32, (fzN / 1600) * 0.26));
  const ringColor = util >= 0.95 ? "#DC2626" : util >= 0.85 ? "#D97706" : "#10B981";

  const [cx, , cz] = contactPos;
  const fxEnd: [number, number, number] = [cx + fxN * forceScale, 0.015, cz];
  const fyEnd: [number, number, number] = [cx, 0.015, cz - fyN * forceScale];
  const fzEnd: [number, number, number] = [cx, Math.max(0.05, fzN * forceScale), cz];

  return (
    <group>
      {showRings ? (
        <mesh position={[cx, 0.004, cz]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[ringRadius * 0.82, ringRadius, 32]} />
          <meshBasicMaterial color={ringColor} side={THREE.DoubleSide} transparent opacity={0.85} />
        </mesh>
      ) : null}

      {showVectors ? (
        <group>
          {/* Fz vertical load (Gold) */}
          <Line points={[[cx, 0.005, cz], fzEnd]} color="#C5A059" lineWidth={2.0} />
          {/* Fy lateral force (Cyan) */}
          <Line points={[[cx, 0.015, cz], fyEnd]} color="#38BDF8" lineWidth={2.0} />
          {/* Fx longitudinal force (Green/Red) */}
          <Line
            points={[[cx, 0.015, cz], fxEnd]}
            color={fxN >= 0 ? "#10B981" : "#DC2626"}
            lineWidth={2.0}
          />
        </group>
      ) : null}
    </group>
  );
}

function TeR27DigitalTwinScene({
  overview,
  latestFrameRef,
  layers,
  preset,
  presetTrigger,
}: {
  overview: VehicleOverviewResponse;
  latestFrameRef: React.MutableRefObject<TelemetryFrame>;
  layers: KinematicsLayerToggles;
  preset: CameraPresetId;
  presetTrigger: number;
}) {
  const chassisGroupRef = useRef<THREE.Group | null>(null);
  const spinAngleRef = useRef<number>(0);
  const [liveSnap, setLiveSnap] = useState<TelemetryFrame>(latestFrameRef.current);

  const p = overview.params;
  const xFront = p.wheelbase_m * (1 - p.front_weight_dist);
  const xRear = -p.wheelbase_m * p.front_weight_dist;
  const halfTrackF = p.track_front_m / 2;
  const halfTrackR = p.track_rear_m / 2;
  const wheelR = p.wheel_radius_m;
  const wheelW = 0.19; // Hoosier 16.0x7.5-10 ~ 7.5 in = 0.1905 m

  const hasFrontHp = hasNonZeroHardpoints(overview.suspension.front_left_hardpoints);
  const hasRearHp = hasNonZeroHardpoints(overview.suspension.rear_left_hardpoints);

  // Throttle React prop sync to ~20 fps while keeping smooth 60 fps chassis/wheel spin
  const lastSyncRef = useRef(0);
  useFrame((state, delta) => {
    const f = latestFrameRef.current;
    spinAngleRef.current += (f.state.vx / Math.max(0.15, wheelR)) * Math.min(delta, 0.05);

    if (chassisGroupRef.current) {
      const heaveM =
        (f.wheels.fl.wheel_travel_m +
          f.wheels.fr.wheel_travel_m +
          f.wheels.rl.wheel_travel_m +
          f.wheels.rr.wheel_travel_m) /
        4;
      const rollRad = ((f.state.ay_g * 0.80) * Math.PI) / 180;
      const pitchRad = ((f.state.ax_g * 0.52) * Math.PI) / 180;
      chassisGroupRef.current.position.y = -heaveM;
      chassisGroupRef.current.rotation.x = rollRad;
      chassisGroupRef.current.rotation.z = -pitchRad;
    }

    if (state.clock.elapsedTime - lastSyncRef.current > 0.05) {
      lastSyncRef.current = state.clock.elapsedTime;
      setLiveSnap(f);
    }
  });

  const steerRad = (liveSnap.state.steer_deg * Math.PI) / 180;

  // Monocoque structural wireframe edges
  const monocoqueEdges = useMemo<Array<[[number, number, number], [number, number, number]]>>(() => {
    const noseX = xFront + 0.42;
    const bulkFrontX = xFront + 0.04;
    const cockpitX = 0.05;
    const hoopX = xRear + 0.24;
    const tailX = xRear - 0.14;
    const wFront = 0.23;
    const wMid = 0.29;
    const wRear = 0.25;
    const zFloor = 0.055;
    const zTopFront = 0.42;
    const zTopMid = 0.50;
    const zHoop = 0.94;

    return [
      // Floor perimeter
      [[noseX, zFloor + 0.04, -0.09], [noseX, zFloor + 0.04, 0.09]],
      [[noseX, zFloor + 0.04, -0.09], [bulkFrontX, zFloor, -wFront]],
      [[noseX, zFloor + 0.04, 0.09], [bulkFrontX, zFloor, wFront]],
      [[bulkFrontX, zFloor, -wFront], [cockpitX, zFloor, -wMid]],
      [[bulkFrontX, zFloor, wFront], [cockpitX, zFloor, wMid]],
      [[cockpitX, zFloor, -wMid], [tailX, zFloor, -wRear]],
      [[cockpitX, zFloor, wMid], [tailX, zFloor, wRear]],
      [[tailX, zFloor, -wRear], [tailX, zFloor, wRear]],
      // Upper rails
      [[noseX, zFloor + 0.14, -0.07], [bulkFrontX, zTopFront, -wFront * 0.85]],
      [[noseX, zFloor + 0.14, 0.07], [bulkFrontX, zTopFront, wFront * 0.85]],
      [[bulkFrontX, zTopFront, -wFront * 0.85], [cockpitX, zTopMid, -wMid * 0.9]],
      [[bulkFrontX, zTopFront, wFront * 0.85], [cockpitX, zTopMid, wMid * 0.9]],
      [[cockpitX, zTopMid, -wMid * 0.9], [hoopX, zTopMid + 0.04, -wRear]],
      [[cockpitX, zTopMid, wMid * 0.9], [hoopX, zTopMid + 0.04, wRear]],
      [[hoopX, zTopMid + 0.04, -wRear], [tailX, zTopFront - 0.06, -wRear * 0.85]],
      [[hoopX, zTopMid + 0.04, wRear], [tailX, zTopFront - 0.06, wRear * 0.85]],
      // Bulkhead verticals & Main Roll Hoop
      [[bulkFrontX, zFloor, -wFront], [bulkFrontX, zTopFront, -wFront * 0.85]],
      [[bulkFrontX, zFloor, wFront], [bulkFrontX, zTopFront, wFront * 0.85]],
      [[bulkFrontX, zTopFront, -wFront * 0.85], [bulkFrontX, zTopFront, wFront * 0.85]],
      [[hoopX, zFloor, -wRear], [hoopX, zHoop, -0.14]],
      [[hoopX, zFloor, wRear], [hoopX, zHoop, 0.14]],
      [[hoopX, zHoop, -0.14], [hoopX, zHoop, 0.14]],
      [[hoopX, zHoop, -0.14], [tailX, zFloor + 0.16, -wRear * 0.85]],
      [[hoopX, zHoop, 0.14], [tailX, zFloor + 0.16, wRear * 0.85]],
    ];
  }, [xFront, xRear]);

  const corners: Array<{
    key: "fl" | "fr" | "rl" | "rr";
    pos: [number, number, number];
    contact: [number, number, number];
    isFront: boolean;
    isLeft: boolean;
  }> = [
    {
      key: "fl",
      pos: [xFront, wheelR + liveSnap.wheels.fl.wheel_travel_m, -halfTrackF],
      contact: [xFront, 0, -halfTrackF],
      isFront: true,
      isLeft: true,
    },
    {
      key: "fr",
      pos: [xFront, wheelR + liveSnap.wheels.fr.wheel_travel_m, halfTrackF],
      contact: [xFront, 0, halfTrackF],
      isFront: true,
      isLeft: false,
    },
    {
      key: "rl",
      pos: [xRear, wheelR + liveSnap.wheels.rl.wheel_travel_m, -halfTrackR],
      contact: [xRear, 0, -halfTrackR],
      isFront: false,
      isLeft: true,
    },
    {
      key: "rr",
      pos: [xRear, wheelR + liveSnap.wheels.rr.wheel_travel_m, halfTrackR],
      contact: [xRear, 0, halfTrackR],
      isFront: false,
      isLeft: false,
    },
  ];

  // Dynamic Roll Axis construction (using CG & confirmed anti-dive/anti-squat angles)
  const frontRcY = 0.048 + liveSnap.state.ay_g * 0.008;
  const rearRcY = 0.068 + liveSnap.state.ay_g * 0.011;

  return (
    <>
      <color attach="background" args={["#08090C"]} />
      <fog attach="fog" args={["#08090C", 7.5, 16]} />
      <StudioEnvironment />

      {/* 3-Point Technical Lighting Rig */}
      <hemisphereLight args={["#94A3B8", "#0F1116", 0.55]} />
      <directionalLight
        position={[4, 6, 4]}
        intensity={1.65}
        color="#FFF6E8"
        castShadow={!isSoftwareGl}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0005}
      />
      <directionalLight position={[-4, 3, -3]} intensity={0.75} color="#BAE6FD" />

      <FloorMeasurementGrid />
      <CameraRig preset={preset} presetTrigger={presetTrigger} />

      {/* Sprung Mass Monocoque Assembly */}
      <group ref={chassisGroupRef}>
        {/* Carbon Monocoque Structural Tub (semi-matte composite) */}
        <mesh position={[0.06, 0.25, 0]} castShadow={!isSoftwareGl}>
          <boxGeometry args={[p.wheelbase_m * 0.88, 0.28, 0.44]} />
          <meshStandardMaterial
            color="#151820"
            metalness={0.25}
            roughness={0.62}
            transparent
            opacity={layers.wireframeChassis ? 0.52 : 0.92}
          />
        </mesh>

        {/* Nose Cone Taper */}
        <mesh position={[xFront + 0.18, 0.19, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.16, 0.56, 4]} />
          <meshStandardMaterial color="#1B1F2A" metalness={0.35} roughness={0.5} />
        </mesh>

        {/* Front & Rear Aero Reference Wings */}
        <mesh position={[xFront + 0.44, 0.09, 0]}>
          <boxGeometry args={[0.24, 0.02, p.track_front_m * 1.04]} />
          <meshStandardMaterial color="#1E2330" metalness={0.4} roughness={0.48} />
        </mesh>
        <mesh position={[xRear - 0.16, 0.86, 0]}>
          <boxGeometry args={[0.28, 0.025, p.track_rear_m * 0.86]} />
          <meshStandardMaterial color="#1E2330" metalness={0.4} roughness={0.48} />
        </mesh>

        {/* CG Reference Marker */}
        <mesh position={[0, p.cg_height_m, 0]}>
          <sphereGeometry args={[0.028, 16, 16]} />
          <meshStandardMaterial color="#C5A059" metalness={0.9} roughness={0.18} />
        </mesh>

        {/* CAD Structural Wireframe */}
        {layers.wireframeChassis
          ? monocoqueEdges.map((seg, idx) => (
              <Line key={idx} points={seg} color="#4A556E" lineWidth={1.1} />
            ))
          : null}

        {/* Exact Confirmed Double-Wishbone Linkages (only rendered when confirmed hardpoints are present) */}
        {hasFrontHp ? (
          <>
            <CornerSuspensionLinkage
              corner={overview.suspension.front_left_hardpoints}
              mirrorRight={false}
              wheelTravelM={liveSnap.wheels.fl.wheel_travel_m}
            />
            <CornerSuspensionLinkage
              corner={overview.suspension.front_left_hardpoints}
              mirrorRight={true}
              wheelTravelM={liveSnap.wheels.fr.wheel_travel_m}
            />
          </>
        ) : null}

        {hasRearHp ? (
          <>
            <CornerSuspensionLinkage
              corner={overview.suspension.rear_left_hardpoints}
              mirrorRight={false}
              wheelTravelM={liveSnap.wheels.rl.wheel_travel_m}
            />
            <CornerSuspensionLinkage
              corner={overview.suspension.rear_left_hardpoints}
              mirrorRight={true}
              wheelTravelM={liveSnap.wheels.rr.wheel_travel_m}
            />
          </>
        ) : null}
      </group>

      {/* 4 Articulated Wheels & Contact Patch Physics Layers */}
      {corners.map((c) => {
        const wState = liveSnap.wheels[c.key];
        return (
          <group key={c.key}>
            <CompositeWheelAssembly
              position={c.pos}
              radiusM={wheelR}
              widthM={wheelW}
              steerRad={c.isFront ? steerRad : 0}
              camberRad={(wState.camber_deg * Math.PI) / 180}
              isLeft={c.isLeft}
              spinAngleRef={spinAngleRef}
            />
            <ForceVectorsAndRing
              contactPos={c.contact}
              fxN={wState.fx_n}
              fyN={wState.fy_n}
              fzN={wState.fz_n}
              util={wState.tire_util}
              showVectors={layers.forceVectors}
              showRings={layers.frictionRings}
            />
          </group>
        );
      })}

      {/* Roll Axis & IC Construction Lines */}
      {layers.rollCenterLines ? (
        <group>
          <Line
            points={[
              [xFront, frontRcY, 0],
              [xRear, rearRcY, 0],
            ]}
            color="#C5A059"
            lineWidth={2.0}
          />
          <Line
            points={[
              [xFront, 0.005, -halfTrackF],
              [xFront, frontRcY, 0],
              [xFront, 0.005, halfTrackF],
            ]}
            color="#38BDF8"
            lineWidth={1.1}
          />
          <Line
            points={[
              [xRear, 0.005, -halfTrackR],
              [xRear, rearRcY, 0],
              [xRear, 0.005, halfTrackR],
            ]}
            color="#38BDF8"
            lineWidth={1.1}
          />
        </group>
      ) : null}

      {/* Anti-Dive (56.9%) & Anti-Squat (41.2%) Side-View Geometry Planes */}
      {layers.antiGeometryPlanes ? (
        <group>
          {/* Front Anti-Dive Line from front contact patch toward CG plane */}
          <Line
            points={[
              [xFront, 0.005, -halfTrackF],
              [
                xFront - p.wheelbase_m * 0.6,
                p.cg_height_m * overview.suspension.anti_dive_front * 1.15,
                -halfTrackF,
              ],
            ]}
            color="#D97706"
            lineWidth={1.4}
          />
          {/* Rear Anti-Squat Line from rear contact patch toward CG plane */}
          <Line
            points={[
              [xRear, 0.005, -halfTrackR],
              [
                xRear + p.wheelbase_m * 0.6,
                p.cg_height_m * overview.suspension.anti_squat_rear * 1.15,
                -halfTrackR,
              ],
            ]}
            color="#10B981"
            lineWidth={1.4}
          />
        </group>
      ) : null}
    </>
  );
}

export function Vehicle3DViewport() {
  const {
    vehicleOverview,
    frame,
    latestFrameRef,
    importConfirmedHardpoints,
  } = useTelemetryStore();

  const [preset, setPreset] = useState<CameraPresetId>("ISO");
  const [presetTrigger, setPresetTrigger] = useState<number>(0);
  const [layers, setLayers] = useState<KinematicsLayerToggles>({
    forceVectors: true,
    frictionRings: true,
    rollCenterLines: true,
    antiGeometryPlanes: false,
    wireframeChassis: true,
  });

  const handleSelectPreset = (next: CameraPresetId) => {
    setPreset(next);
    setPresetTrigger((n) => n + 1);
  };

  const toggleLayer = (key: keyof KinematicsLayerToggles) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const hardpointsLoaded = Boolean(
    vehicleOverview && hasNonZeroHardpoints(vehicleOverview.suspension.front_left_hardpoints)
  );

  if (!vehicleOverview) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#08090C] font-mono text-[11px] text-[#7E8799]">
        Loading TeR27 4WD overview parameters...
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-0 overflow-hidden bg-[#08090C]">
      <SplitPane
        direction="horizontal"
        initialRatio={0.72}
        minRatio={0.5}
        maxRatio={0.82}
        first={
          <div className="w-full h-full min-h-0 flex flex-col bg-[#08090C] relative">
            {/* Viewport Top Bar: Camera Presets & Confirmed Envelope Readout */}
            <div className="panel-header-bar gap-2 z-10">
              <div className="flex items-center gap-2">
                <span className="panel-title-label">3D Spatial Digital Twin // TeR27 4WD</span>
                <span className="text-[10px] font-mono text-[#7E8799]">
                  WB {vehicleOverview.params.wheelbase_m.toFixed(2)}m / TRK{" "}
                  {vehicleOverview.params.track_front_m.toFixed(2)}m / CG{" "}
                  {(vehicleOverview.params.cg_height_m * 1000).toFixed(0)}mm
                </span>
              </div>

              <div className="flex items-center gap-1">
                {(Object.keys(CAMERA_PRESETS) as CameraPresetId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectPreset(id)}
                    className={`px-2 py-0.5 text-[10px] font-mono border rounded-[2px] cursor-pointer ${
                      preset === id
                        ? "border-[#C5A059] text-[#C5A059] bg-[#1B1F2A]"
                        : "border-[#222633] text-[#7E8799] bg-[#08090C] hover:text-[#ECEFF4]"
                    }`}
                  >
                    {id.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            {/* R3F WebGL Canvas Stage */}
            <div className="flex-1 min-h-0 w-full relative">
              <Canvas
                shadows={!isSoftwareGl}
                dpr={isSoftwareGl ? 1 : [1, 2]}
                camera={{ position: CAMERA_PRESETS.ISO.pos, fov: 38, near: 0.05, far: 50 }}
                gl={{
                  antialias: !isSoftwareGl,
                  powerPreference: "high-performance",
                  toneMapping: THREE.ACESFilmicToneMapping,
                  toneMappingExposure: 1.08,
                }}
              >
                <TeR27DigitalTwinScene
                  overview={vehicleOverview}
                  latestFrameRef={latestFrameRef}
                  layers={layers}
                  preset={preset}
                  presetTrigger={presetTrigger}
                />
              </Canvas>

              {/* Compact Bottom Legend Strip (solid surface, zero backdrop-blur over WebGL) */}
              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between px-2.5 py-1 bg-[#0F1116] border border-[#222633] rounded-[2px] font-mono text-[10px] text-[#7E8799] pointer-events-none">
                <div className="flex items-center gap-3">
                  <span>
                    STEER <strong className="text-[#ECEFF4]">{frame.state.steer_deg.toFixed(1)} deg</strong>
                  </span>
                  <span>
                    vx <strong className="text-[#ECEFF4]">{(frame.state.vx * 3.6).toFixed(1)} km/h</strong>
                  </span>
                  <span>
                    ay <strong className="text-[#C5A059]">{frame.state.ay_g.toFixed(2)} g</strong>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[#C5A059]">Fz</span>
                  <span className="text-[#38BDF8]">Fy</span>
                  <span className="text-[#10B981]">+Fx</span>
                  <span>0.5 m Grid / Orbit Drag + Scroll Zoom</span>
                </div>
              </div>
            </div>
          </div>
        }
        second={
          <SuspensionKinematicsOverlay
            suspension={vehicleOverview.suspension}
            frame={frame}
            layers={layers}
            onToggleLayer={toggleLayer}
            onImportHardpoints={importConfirmedHardpoints}
            hardpointsLoaded={hardpointsLoaded}
          />
        }
      />
    </div>
  );
}
