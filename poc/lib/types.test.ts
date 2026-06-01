import { describe, it, expect } from "vitest";
import { isValidTransition, TaskStatus } from "./types";

describe("isValidTransition (state machine)", () => {
  it("allows initial WAITING → READY", () => {
    expect(isValidTransition(TaskStatus.WAITING, TaskStatus.READY)).toBe(true);
  });

  it("allows READY → CLAIMED (claim flow)", () => {
    expect(isValidTransition(TaskStatus.READY, TaskStatus.CLAIMED)).toBe(true);
  });

  it("allows CLAIMED → IN_PROGRESS / DONE / FAILED / SKIPPED / READY (timeout)", () => {
    expect(isValidTransition(TaskStatus.CLAIMED, TaskStatus.IN_PROGRESS)).toBe(true);
    expect(isValidTransition(TaskStatus.CLAIMED, TaskStatus.DONE)).toBe(true);
    expect(isValidTransition(TaskStatus.CLAIMED, TaskStatus.FAILED)).toBe(true);
    expect(isValidTransition(TaskStatus.CLAIMED, TaskStatus.SKIPPED)).toBe(true);
    expect(isValidTransition(TaskStatus.CLAIMED, TaskStatus.READY)).toBe(true);
  });

  it("allows the FAILED → READY retry path", () => {
    expect(isValidTransition(TaskStatus.FAILED, TaskStatus.READY)).toBe(true);
  });

  it("allows BLOCKED → WAITING (unblock re-evaluates deps)", () => {
    expect(isValidTransition(TaskStatus.BLOCKED, TaskStatus.WAITING)).toBe(true);
  });

  it("blocks terminal exit transitions", () => {
    // DONE, SKIPPED, CANCELLED are absorbing
    for (const to of Object.values(TaskStatus)) {
      expect(isValidTransition(TaskStatus.DONE, to)).toBe(false);
      expect(isValidTransition(TaskStatus.SKIPPED, to)).toBe(false);
      expect(isValidTransition(TaskStatus.CANCELLED, to)).toBe(false);
    }
  });

  it("blocks WAITING → CLAIMED (must go via READY first)", () => {
    expect(isValidTransition(TaskStatus.WAITING, TaskStatus.CLAIMED)).toBe(false);
  });

  it("blocks WAITING → IN_PROGRESS (no fast-forwarding)", () => {
    expect(isValidTransition(TaskStatus.WAITING, TaskStatus.IN_PROGRESS)).toBe(false);
  });

  it("blocks DONE without going through CLAIMED/IN_PROGRESS/READY", () => {
    expect(isValidTransition(TaskStatus.WAITING, TaskStatus.DONE)).toBe(false);
    expect(isValidTransition(TaskStatus.BLOCKED, TaskStatus.DONE)).toBe(false);
  });

  it("blocks self-loops", () => {
    for (const s of Object.values(TaskStatus)) {
      expect(isValidTransition(s, s)).toBe(false);
    }
  });
});
