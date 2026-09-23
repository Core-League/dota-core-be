import { BadRequestException } from '@nestjs/common';
import {
  getQualificationConfigViolation,
  validateQualificationConfig,
  type TQualificationConfig,
} from './tournament-qualification.util';
import { TournamentStatus } from './tournaments.model';

/**
 * A tournament may skip the qualification stage entirely. Such a tournament can
 * never sit in the QUALIFICATIONS status. Its slot cap stays optional: a missing
 * value means unlimited registration, and the playoff seats every registered
 * team.
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

  it('accepts a no-qualification tournament with a slot cap', () => {
    expect(getQualificationConfigViolation(withoutQualification)).toBeNull();
  });

  it('accepts a no-qualification tournament with no slot limit (unlimited)', () => {
    const unlimited = { ...withoutQualification, tournamentSlots: null };
    expect(getQualificationConfigViolation(unlimited)).toBeNull();
    const omitted = { ...withoutQualification, tournamentSlots: undefined };
    expect(getQualificationConfigViolation(omitted)).toBeNull();
  });

  it('accepts a no-qualification tournament with more slots than eight', () => {
    const many = { ...withoutQualification, tournamentSlots: 16 };
    expect(getQualificationConfigViolation(many)).toBeNull();
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
    const contradictory = {
      ...withoutQualification,
      tournamentStatus: TournamentStatus.QUALIFICATIONS,
    };
    expect(() => validateQualificationConfig(contradictory)).toThrow(
      BadRequestException,
    );
    expect(() => validateQualificationConfig(contradictory)).toThrow(
      'Турнір без кваліфікації не може мати статус «Кваліфікація»',
    );
  });
});
