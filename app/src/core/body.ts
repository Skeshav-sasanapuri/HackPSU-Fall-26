/* Body measurements. Segment lengths use Drillis & Contini proportions (fractions of standing height);
 * the user can override them. Arm mass is the standard ~5% of body mass for upper arm + forearm + hand. */
export interface ArmLengths { upperArm: number; forearm: number; hand: number }

/** metres */
export function armFromHeight(heightM: number): ArmLengths {
  return { upperArm: 0.186 * heightM, forearm: 0.146 * heightM, hand: 0.108 * heightM };
}

export const armMassKg = (bodyKg: number) => 0.05 * bodyKg;

export const cmToFtIn = (cm: number) => {
  const totalIn = cm / 2.54;
  let ft = Math.floor(totalIn / 12);
  let inch = Math.round(totalIn - ft * 12);
  if (inch === 12) { ft += 1; inch = 0; }
  return { ft, inch };
};
export const ftInToCm = (ft: number, inch: number) => (ft * 12 + inch) * 2.54;
export const kgToLb = (kg: number) => kg * 2.2046226218;
export const lbToKg = (lb: number) => lb / 2.2046226218;
