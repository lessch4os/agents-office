import type { Point } from "./waypoints"

export interface Vector { x: number; y: number }

function len(v: Vector): number {
  return Math.sqrt(v.x * v.x + v.y * v.y)
}

function norm(v: Vector, mag: number): Vector {
  const l = len(v)
  if (l === 0) return { x: 0, y: 0 }
  return { x: (v.x / l) * mag, y: (v.y / l) * mag }
}

function clamp(v: Vector, maxMag: number): Vector {
  const l = len(v)
  if (l <= maxMag) return v
  return norm(v, maxMag)
}

// Constant-speed approach; returns steering force to add to acceleration.
export function seek(pos: Point, target: Point, vel: Vector, maxSpeed: number, maxForce: number): Vector {
  const desired = norm({ x: target.x - pos.x, y: target.y - pos.y }, maxSpeed)
  return clamp({ x: desired.x - vel.x, y: desired.y - vel.y }, maxForce)
}

// Decelerate within slowRadius of target.
export function arrive(pos: Point, target: Point, vel: Vector, maxSpeed: number, maxForce: number, slowRadius = 40): Vector {
  const dx = target.x - pos.x
  const dy = target.y - pos.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < 1) return { x: -vel.x * 0.3, y: -vel.y * 0.3 }
  const speed = dist < slowRadius ? maxSpeed * (dist / slowRadius) : maxSpeed
  const desired = { x: (dx / dist) * speed, y: (dy / dist) * speed }
  return clamp({ x: desired.x - vel.x, y: desired.y - vel.y }, maxForce)
}

// Reynolds wander — smoothly drifts. Returns delta to wanderAngle + force.
export function wander(
  pos: Point,
  vel: Vector,
  wanderAngle: number,
  maxSpeed: number,
  maxForce: number,
  canvasW: number,
  canvasH: number,
): { force: Vector; newAngle: number } {
  const newAngle = wanderAngle + (Math.random() - 0.5) * 0.4
  const ahead = norm(vel.x === 0 && vel.y === 0 ? { x: 1, y: 0 } : vel, 30)
  const circleCenter = { x: pos.x + ahead.x, y: pos.y + ahead.y }
  const displacement = {
    x: Math.cos(newAngle) * 12,
    y: Math.sin(newAngle) * 12,
  }
  const wanderTarget = { x: circleCenter.x + displacement.x, y: circleCenter.y + displacement.y }
  const boundedTarget = {
    x: Math.max(30, Math.min(canvasW - 30, wanderTarget.x)),
    y: Math.max(30, Math.min(canvasH - 30, wanderTarget.y)),
  }
  return {
    force: seek(pos, boundedTarget, vel, maxSpeed, maxForce),
    newAngle,
  }
}

// Repulsion force away from a threat (used for collision avoidance).
export function flee(pos: Point, threat: Point, vel: Vector, maxSpeed: number, maxForce: number): Vector {
  const desired = norm({ x: pos.x - threat.x, y: pos.y - threat.y }, maxSpeed)
  return clamp({ x: desired.x - vel.x, y: desired.y - vel.y }, maxForce)
}

export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}
