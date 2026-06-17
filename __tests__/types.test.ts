import { emptyFields, splitName, deliveryFromFields } from '../src/lib/types';

describe('splitName', () => {
  test('Vor- und Nachname', () => {
    expect(splitName('Max Mustermann')).toEqual({ firstName: 'Max', lastName: 'Mustermann' });
  });

  test('mehrteiliger Nachname', () => {
    expect(splitName('Anna von der Heide')).toEqual({
      firstName: 'Anna',
      lastName: 'von der Heide',
    });
  });

  test('einzelner Name -> Vorname = Nachname', () => {
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: 'Cher' });
  });

  test('leer -> Unbekannt', () => {
    expect(splitName('')).toEqual({ firstName: 'Unbekannt', lastName: 'Unbekannt' });
  });
});

describe('deliveryFromFields', () => {
  test('ohne abweichende Lieferadresse -> differs false', () => {
    const d = deliveryFromFields(emptyFields());
    expect(d.differs).toBe(false);
  });

  test('mit Lieferstraße -> differs true', () => {
    const d = deliveryFromFields({ ...emptyFields(), deliveryStreet: 'Lieferweg 1' });
    expect(d.differs).toBe(true);
    expect(d.street).toBe('Lieferweg 1');
  });
});
