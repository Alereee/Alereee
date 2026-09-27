import { licenseLabel } from '../datasetTerms';

// The license of the served dataset the way a reader writes it (issue #527)
describe('licenseLabel', () => {
  it('writes the Creative Commons identifiers with their spaces', () => {
    expect(licenseLabel('CC-BY-4.0')).toBe('CC BY 4.0');
    expect(licenseLabel('CC-BY-SA-4.0')).toBe('CC BY-SA 4.0');
    expect(licenseLabel('CC-BY-SA-3.0')).toBe('CC BY-SA 3.0');
    expect(licenseLabel('CC0-1.0')).toBe('CC0-1.0');
  });

  it('leaves any other identifier as it is', () => {
    expect(licenseLabel('WordNet')).toBe('WordNet');
    expect(licenseLabel('BSD-2-Clause')).toBe('BSD-2-Clause');
    expect(licenseLabel('NOASSERTION')).toBe('NOASSERTION');
  });
});
