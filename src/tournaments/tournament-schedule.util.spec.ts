import { BadRequestException } from '@nestjs/common';
import {
  getScheduleViolation,
  TTournamentSchedule,
  validateTournamentSchedule,
} from './tournament-schedule.util';

/**
 * Ordering rules for the three tournament windows (registration, qualification,
 * playoff). The notable non-rule is that registration may overlap qualification:
 * a team may join while qualification is already running, and every tournament
 * created before the windows were split behaves exactly that way.
 */
describe('validateTournamentSchedule', () => {
  const d = (iso: string) => new Date(iso);

  /** A coherent baseline: registration overlaps qualification, playoff follows. */
  const base: TTournamentSchedule = {
    registrationStartsAt: d('2026-09-01T00:00:00Z'),
    registrationEndsAt: d('2026-09-10T00:00:00Z'),
    qualificationStartsAt: d('2026-09-01T00:00:00Z'),
    qualificationEndsAt: d('2026-09-14T00:00:00Z'),
    tournamentStartsAt: d('2026-09-15T00:00:00Z'),
    tournamentEndsAt: d('2026-09-20T00:00:00Z'),
  };

  const withDates = (
    patch: Partial<TTournamentSchedule>,
  ): TTournamentSchedule => ({
    ...base,
    ...patch,
  });

  it('accepts a coherent schedule', () => {
    expect(getScheduleViolation(base)).toBeNull();
    expect(() => validateTournamentSchedule(base)).not.toThrow();
  });

  it('accepts registration overlapping qualification', () => {
    const overlapping = withDates({
      registrationEndsAt: d('2026-09-12T00:00:00Z'),
      qualificationStartsAt: d('2026-09-05T00:00:00Z'),
    });
    expect(getScheduleViolation(overlapping)).toBeNull();
  });

  it('accepts qualification ending exactly when the playoff starts', () => {
    const touching = withDates({
      qualificationEndsAt: d('2026-09-15T00:00:00Z'),
      tournamentStartsAt: d('2026-09-15T00:00:00Z'),
    });
    expect(getScheduleViolation(touching)).toBeNull();
  });

  it('rejects a registration window that ends before it starts', () => {
    const invalid = withDates({
      registrationStartsAt: d('2026-09-10T00:00:00Z'),
      registrationEndsAt: d('2026-09-01T00:00:00Z'),
    });
    expect(getScheduleViolation(invalid)).toBe(
      'Кінець реєстрації має бути пізніше за початок реєстрації',
    );
  });

  it('rejects a zero-length registration window', () => {
    const invalid = withDates({
      registrationStartsAt: d('2026-09-01T00:00:00Z'),
      registrationEndsAt: d('2026-09-01T00:00:00Z'),
    });
    expect(getScheduleViolation(invalid)).not.toBeNull();
  });

  it('rejects a qualification window that ends before it starts', () => {
    const invalid = withDates({
      qualificationStartsAt: d('2026-09-14T00:00:00Z'),
      qualificationEndsAt: d('2026-09-02T00:00:00Z'),
    });
    expect(getScheduleViolation(invalid)).toBe(
      'Кінець кваліфікації має бути пізніше за початок кваліфікації',
    );
  });

  it('rejects a playoff window that ends before it starts', () => {
    const invalid = withDates({
      tournamentStartsAt: d('2026-09-20T00:00:00Z'),
      tournamentEndsAt: d('2026-09-15T00:00:00Z'),
    });
    expect(getScheduleViolation(invalid)).toBe(
      'Кінець плей-оф має бути пізніше за початок плей-оф',
    );
  });

  it('rejects qualification still running after the playoff starts', () => {
    const invalid = withDates({
      qualificationEndsAt: d('2026-09-16T00:00:00Z'),
      tournamentStartsAt: d('2026-09-15T00:00:00Z'),
    });
    expect(getScheduleViolation(invalid)).toBe(
      'Кваліфікація має завершитися до початку плей-оф',
    );
  });

  it('throws a BadRequestException carrying the violation message', () => {
    const invalid = withDates({
      qualificationEndsAt: d('2026-09-16T00:00:00Z'),
    });
    expect(() => validateTournamentSchedule(invalid)).toThrow(
      BadRequestException,
    );
    expect(() => validateTournamentSchedule(invalid)).toThrow(
      'Кваліфікація має завершитися до початку плей-оф',
    );
  });

  describe('without a qualification stage', () => {
    /** `hasQualification = false` leaves both qualification columns null. */
    const noQualification: TTournamentSchedule = {
      ...base,
      qualificationStartsAt: null,
      qualificationEndsAt: null,
    };

    it('accepts a schedule with no qualification window', () => {
      expect(getScheduleViolation(noQualification)).toBeNull();
      expect(() => validateTournamentSchedule(noQualification)).not.toThrow();
    });

    it('still enforces the registration window', () => {
      const invalid = {
        ...noQualification,
        registrationStartsAt: d('2026-09-10T00:00:00Z'),
        registrationEndsAt: d('2026-09-01T00:00:00Z'),
      };
      expect(getScheduleViolation(invalid)).toBe(
        'Кінець реєстрації має бути пізніше за початок реєстрації',
      );
    });

    it('still enforces the playoff window', () => {
      const invalid = {
        ...noQualification,
        tournamentStartsAt: d('2026-09-20T00:00:00Z'),
        tournamentEndsAt: d('2026-09-15T00:00:00Z'),
      };
      expect(getScheduleViolation(invalid)).toBe(
        'Кінець плей-оф має бути пізніше за початок плей-оф',
      );
    });

    it('drops the qualification-before-playoff rule rather than failing it', () => {
      // Registration runs past the bracket start, which only the (absent)
      // qualification rule could have objected to.
      const late = {
        ...noQualification,
        registrationEndsAt: d('2026-09-18T00:00:00Z'),
      };
      expect(getScheduleViolation(late)).toBeNull();
    });
  });

  it('ignores rules whose dates are absent, leaving that to DTO validation', () => {
    const partial = {
      qualificationStartsAt: d('2026-09-01T00:00:00Z'),
      qualificationEndsAt: d('2026-09-14T00:00:00Z'),
    } as TTournamentSchedule;
    expect(getScheduleViolation(partial)).toBeNull();
  });
});
