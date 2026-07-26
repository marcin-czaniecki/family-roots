import styled from "styled-components";
import type { PersonFormValues } from "@/features/personForm";

type PersonFormFieldsProps = {
  value: PersonFormValues;
  onChange: (value: PersonFormValues) => void;
  idPrefix: string;
  autoFocus?: boolean;
};

export function PersonFormFields({ value, onChange, idPrefix, autoFocus = false }: PersonFormFieldsProps) {
  const update = <K extends keyof PersonFormValues>(key: K, fieldValue: PersonFormValues[K]) => {
    onChange({ ...value, [key]: fieldValue });
  };

  return (
    <FieldsRoot>
      <FieldGrid>
        <Field>
          <Label htmlFor={`${idPrefix}-first-name`}>Imię *</Label>
          <Input
            id={`${idPrefix}-first-name`}
            value={value.firstName}
            onChange={(event) => update("firstName", event.target.value)}
            autoFocus={autoFocus}
            required
          />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-last-name`}>Nazwisko *</Label>
          <Input id={`${idPrefix}-last-name`} value={value.lastName} onChange={(event) => update("lastName", event.target.value)} required />
        </Field>
        <Field $span>
          <Label htmlFor={`${idPrefix}-middle-names`}>Drugie imiona</Label>
          <Input
            id={`${idPrefix}-middle-names`}
            value={value.middleNames}
            placeholder="oddzielone przecinkami"
            onChange={(event) => update("middleNames", event.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-birth-surname`}>Nazwisko rodowe</Label>
          <Input id={`${idPrefix}-birth-surname`} value={value.birthSurname} onChange={(event) => update("birthSurname", event.target.value)} />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-sex`}>Płeć</Label>
          <Select id={`${idPrefix}-sex`} value={value.sex} onChange={(event) => update("sex", event.target.value as PersonFormValues["sex"])}>
            <option value="female">Kobieta</option>
            <option value="male">Mężczyzna</option>
          </Select>
        </Field>
      </FieldGrid>

      <SectionLabel>Urodzenie</SectionLabel>
      <DateGrid>
        <Field>
          <Label htmlFor={`${idPrefix}-birth-day`}>Dzień</Label>
          <Input
            id={`${idPrefix}-birth-day`}
            inputMode="numeric"
            placeholder="dd"
            value={value.birthDay}
            onChange={(event) => update("birthDay", event.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-birth-month`}>Miesiąc</Label>
          <Input
            id={`${idPrefix}-birth-month`}
            inputMode="numeric"
            placeholder="mm"
            value={value.birthMonth}
            onChange={(event) => update("birthMonth", event.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-birth-year`}>Rok</Label>
          <Input
            id={`${idPrefix}-birth-year`}
            inputMode="numeric"
            placeholder="rrrr"
            value={value.birthYear}
            onChange={(event) => update("birthYear", event.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-birth-place`}>Miejsce</Label>
          <Input id={`${idPrefix}-birth-place`} value={value.birthPlace} onChange={(event) => update("birthPlace", event.target.value)} />
        </Field>
      </DateGrid>

      <SectionLabel>Śmierć</SectionLabel>
      <DateGrid>
        <Field>
          <Label htmlFor={`${idPrefix}-death-day`}>Dzień</Label>
          <Input
            id={`${idPrefix}-death-day`}
            inputMode="numeric"
            placeholder="dd"
            value={value.deathDay}
            onChange={(event) => update("deathDay", event.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-death-month`}>Miesiąc</Label>
          <Input
            id={`${idPrefix}-death-month`}
            inputMode="numeric"
            placeholder="mm"
            value={value.deathMonth}
            onChange={(event) => update("deathMonth", event.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-death-year`}>Rok</Label>
          <Input
            id={`${idPrefix}-death-year`}
            inputMode="numeric"
            placeholder="rrrr"
            value={value.deathYear}
            onChange={(event) => update("deathYear", event.target.value)}
          />
        </Field>
        <Field>
          <Label htmlFor={`${idPrefix}-death-place`}>Miejsce</Label>
          <Input id={`${idPrefix}-death-place`} value={value.deathPlace} onChange={(event) => update("deathPlace", event.target.value)} />
        </Field>
      </DateGrid>

      <SectionLabel>Informacje dodatkowe</SectionLabel>
      <FieldGrid>
        <Field $span>
          <Label htmlFor={`${idPrefix}-biography`}>Biografia</Label>
          <Textarea id={`${idPrefix}-biography`} rows={5} value={value.biography} onChange={(event) => update("biography", event.target.value)} />
        </Field>
      </FieldGrid>
    </FieldsRoot>
  );
}

const FieldsRoot = styled.div`
  --form-ink: var(--ink, #1c2a22);
  --form-muted: var(--muted, #5c6b62);
  --form-line: var(--line, #c5b8a4);
  --form-accent: var(--accent, #3d5a4c);
`;

const FieldGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.75rem;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const DateGrid = styled(FieldGrid)`
  grid-template-columns: minmax(4.5rem, 0.65fr) minmax(4.5rem, 0.65fr) minmax(5.5rem, 0.8fr) minmax(8rem, 2fr);

  @media (max-width: 720px) {
    grid-template-columns: 1fr 1fr;
  }

  @media (max-width: 420px) {
    grid-template-columns: 1fr;
  }
`;

const Field = styled.div<{ $span?: boolean }>`
  grid-column: ${({ $span }) => ($span ? "1 / -1" : "auto")};
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
`;

const Label = styled.label`
  color: var(--form-muted);
  font-size: 0.75rem;
`;

const controlStyles = `
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--form-line);
  background: #fff;
  color: var(--form-ink);
  padding: 0.58rem 0.65rem;
  font: inherit;
  font-size: 0.9rem;
  outline: none;

  &:focus {
    border-color: var(--form-accent);
    box-shadow: 0 0 0 1px var(--form-accent);
  }
`;

const Input = styled.input`
  ${controlStyles}
`;

const Select = styled.select`
  ${controlStyles}
`;

const Textarea = styled.textarea`
  ${controlStyles}
  min-height: 7rem;
  resize: vertical;
`;

const SectionLabel = styled.h3`
  margin: 1rem 0 0.5rem;
  color: var(--form-muted);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
`;
