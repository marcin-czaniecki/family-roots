import { useEffect, useId, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { matchesPersonQuery, personDatesOrId, personLabel, personName } from "@/entities/person/label";
import type { Person } from "@/entities/person/types";

const RESULT_LIMIT = 40;

type PersonSearchSelectProps = {
  id?: string;
  people: Person[];
  value: string;
  onChange: (personId: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  required?: boolean;
};

export function PersonSearchSelect({
  id,
  people,
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = "— brak —",
  placeholder = "Szukaj osoby (imię, data, id)…",
  required = false,
}: PersonSearchSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => people.find((person) => person.id === value) ?? null, [people, value]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const results = useMemo(() => {
    const filtered = people.filter((person) => matchesPersonQuery(person, query));
    return filtered.slice(0, RESULT_LIMIT);
  }, [people, query]);

  const displayValue = open ? query : selected ? personLabel(selected) : "";

  const selectPerson = (personId: string) => {
    onChange(personId);
    setOpen(false);
  };

  return (
    <Root ref={rootRef}>
      <SearchRow>
        <SearchInput
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={selected && !open ? personLabel(selected) : placeholder}
          value={displayValue}
          required={required && !value}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter") {
              e.preventDefault();
              if (results[0]) selectPerson(results[0].id);
            }
          }}
        />
        {value ? (
          <ClearButton
            type="button"
            aria-label="Wyczyść wybór"
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(false);
            }}
          >
            ×
          </ClearButton>
        ) : null}
      </SearchRow>

      {open ? (
        <Dropdown id={listId} role="listbox">
          {allowEmpty ? (
            <OptionButton type="button" role="option" aria-selected={!value} onClick={() => selectPerson("")}>
              {emptyLabel}
            </OptionButton>
          ) : null}
          {results.length === 0 ? (
            <Empty>Brak wyników</Empty>
          ) : (
            results.map((person) => {
              const hint = personDatesOrId(person);
              return (
                <OptionButton
                  key={person.id}
                  type="button"
                  role="option"
                  aria-selected={person.id === value}
                  $active={person.id === value}
                  onClick={() => selectPerson(person.id)}
                >
                  <OptionName>{personName(person)}</OptionName>
                  <OptionHint>{hint.text}</OptionHint>
                </OptionButton>
              );
            })
          )}
          {people.filter((person) => matchesPersonQuery(person, query)).length > RESULT_LIMIT ? (
            <Empty>Pokazano pierwsze {RESULT_LIMIT} — zawęź wyszukiwanie</Empty>
          ) : null}
        </Dropdown>
      ) : null}
    </Root>
  );
}

const Root = styled.div`
  position: relative;
`;

const SearchRow = styled.div`
  position: relative;
  display: flex;
  align-items: center;
`;

const SearchInput = styled.input`
  width: 100%;
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  padding: 0.55rem 2rem 0.55rem 0.65rem;
  font: inherit;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.15s ease;

  &:focus {
    border-color: var(--accent);
  }
`;

const ClearButton = styled.button`
  position: absolute;
  right: 0.35rem;
  border: none;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 1.2rem;
  line-height: 1;
  padding: 0.2rem 0.35rem;
  cursor: pointer;

  &:hover {
    color: var(--ink);
  }
`;

const Dropdown = styled.div`
  position: absolute;
  z-index: 20;
  top: calc(100% + 0.25rem);
  left: 0;
  right: 0;
  max-height: 16rem;
  overflow: auto;
  border: 1px solid var(--line);
  background: #fff;
  box-shadow: 0 8px 24px rgba(28, 42, 34, 0.12);
`;

const OptionButton = styled.button<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--line);
  background: ${({ $active }) => ($active ? "#e8efe9" : "#fff")};
  color: var(--ink);
  text-align: left;
  padding: 0.55rem 0.7rem;
  font: inherit;
  cursor: pointer;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: #f3efe8;
  }
`;

const OptionName = styled.span`
  font-size: 0.92rem;
`;

const OptionHint = styled.span`
  font-size: 0.75rem;
  color: var(--muted);
  text-decoration: underline;
  text-underline-offset: 0.12em;
  font-variant-numeric: tabular-nums;
`;

const Empty = styled.div`
  padding: 0.65rem 0.7rem;
  color: var(--muted);
  font-size: 0.82rem;
`;
