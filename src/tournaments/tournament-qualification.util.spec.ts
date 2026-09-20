import { BadRequestException } from '@nestjs/common';
import {
  getQualificationConfigViolation,
  validateQualificationConfig,
  type TQualificationConfig,
} from './tournament-qualification.util';
import { TournamentStatus } from './tournaments.model';

/**
 * A tournament may skip the qualification stage entirely. Without it there are
 * no standings to rank by, so the field must already fit the playoff bracket
 * and the tournament can never sit in the QUALIFICATIONS status.
 */
describe('validateQualificationConfig', () => {
  const withQualification: TQualificationConfig = {
    hasQualification: true,
    tournamentSlots: 32,
    tournamentStatus: TournamentStatus.REGISTRATION,
  };

  const withoutQualification: TQualificationConfig = {
    hasQualification: false,
    tournamentSlots: 8,
    tournamentStatus: TournamentStatus.REGISTRATION,
  };

  it('accepts a tournament that runs a qualification stage', () => {
    expect(getQualificationConfigViolation(withQualification)).toBeNull();
    expect(() => validateQualificationConfig(withQualification)).not.toThrow();
  });

  it('leaves slots unconstrained when qualification is enabled', () => {
    const many = { ...withQualification, tournamentSlots: 128 };
    expect(getQualificationConfigViolation(many)).toBeNull();
  });

  it('allows QUALIFICATIONS status when qualification is enabled', () => {
    const qualifying = {
      ...withQualification,
      tournamentStatus: TournamentStatus.QUALIFICATIONS,
    };
    expect(getQualificationConfigViolation(qualifying)).toBeNull();
  });

  it('accepts a no-qualification tournament whose field fits the bracket', () => {
    expect(getQualificationConfigViolation(withoutQualification)).toBeNull();
  });

  it('accepts a no-qualification tournament with fewer slots than the bracket', () => {
    const small = { ...withoutQualification, tournamentSlots: 4 };
    expect(getQualificationConfigViolation(small)).toBeNull();
  });

  it('rejects a no-qualification tournament with no slot limit', () => {
    const unlimited = { ...withoutQualification, tournamentSlots: null };
    expect(getQualificationConfigViolation(unlimited)).toBe(
      'Для турніру без кваліфікації потрібно вказати слоти команд (не більше 8)',
    );
  });

  it('rejects a no-qualification tournament with more slots than the bracket', () => {
    const tooMany = { ...withoutQualification, tournamentSlots: 9 };
    expect(getQualificationConfigViolation(tooMany)).toBe(
      'Без кваліфікації слотів команд не може бути більше 8',
    );
  });

  it('rejects QUALIFICATIONS status when qualification is disabled', () => {
    const contradictory = {
      ...withoutQualification,
      tournamentStatus: TournamentStatus.QUALIFICATIONS,
    };
    expect(getQualificationConfigViolation(contradictory)).toBe(
      'Турнір без кваліфікації не може мати статус «Кваліфікація»',
    );
  });

  it('throws a BadRequestException carrying the violation message', () => {
    const tooMany = { ...withoutQualification, tournamentSlots: 9 };
    expect(() => validateQualificationConfig(tooMany)).toThrow(
      BadRequestException,
    );
    expect(() => validateQualificationConfig(tooMany)).toThrow(
      'Без кваліфікації слотів команд не може бути більше 8',
    );
  });
});
