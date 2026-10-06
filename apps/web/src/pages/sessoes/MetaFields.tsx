/* Campos dos dados da sessão (data, pista, carro, piloto, etiquetas, notas), usados no envio
 * de logs, no "Editar dados" da lista e na Visão geral. Pista e carro são os perfis da
 * biblioteca ativa (páginas Pista e GPS / Carro). */
import { Autocomplete, Group, Select, SimpleGrid, TagsInput, Textarea, TextInput } from '@mantine/core';
import { IconCalendar, IconCar, IconClock, IconRoute, IconTag, IconUser } from '@tabler/icons-react';
import { useProfiles } from '../../state/profiles';
import type { MetaDraft } from './meta';

export interface MetaFieldsProps {
  value: MetaDraft;
  onChange: (patch: Partial<MetaDraft>) => void;
  /** pilotos e etiquetas já usados (sugestões) */
  drivers?: string[];
  tags?: string[];
  /** mostra o campo do nome */
  withName?: boolean;
  /** mostra data e hora (no envio de vários arquivos a data é por arquivo) */
  withDate?: boolean;
  /** mostra as notas */
  withNotes?: boolean;
  disabled?: boolean;
}

export function MetaFields({ value, onChange, drivers = [], tags = [], withName, withDate = true, withNotes = true, disabled }: MetaFieldsProps) {
  const cars = useProfiles(s => s.cars);
  const tracks = useProfiles(s => s.tracks);
  const carData = cars.map(c => ({ value: c.id, label: c.name }));
  const trackData = tracks.map(t => ({ value: t.id, label: t.name }));
  return (
    <>
      {withName && (
        <TextInput label="Nome da sessão" size="md" value={value.name} disabled={disabled}
          onChange={e => onChange({ name: e.currentTarget.value })} mb="sm" />
      )}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="sm">
        {withDate && (
          <Group gap="sm" wrap="wrap" align="flex-end" style={{ gridColumn: '1 / -1' }}>
            <TextInput type="date" label="Data do teste" size="md" leftSection={<IconCalendar size={17} />} w={210}
              value={value.day} disabled={disabled} onChange={e => onChange({ day: e.currentTarget.value })} />
            <TextInput type="time" label="Hora" size="md" leftSection={<IconClock size={17} />} w={150}
              value={value.time} disabled={disabled || !value.day} onChange={e => onChange({ time: e.currentTarget.value })} />
          </Group>
        )}
        <Autocomplete label="Piloto" size="md" leftSection={<IconUser size={17} />} placeholder="quem pilotou"
          data={drivers} value={value.driver} disabled={disabled} onChange={v => onChange({ driver: v })} />
        <Select label="Pista" size="md" leftSection={<IconRoute size={17} />} clearable searchable
          placeholder={trackData.length ? 'escolha o perfil da pista' : 'nenhum perfil (crie em Pista e GPS)'}
          data={trackData} value={value.trackId} disabled={disabled} onChange={v => onChange({ trackId: v })}
          nothingFoundMessage="Nenhuma pista com esse nome" />
        <Select label="Carro" size="md" leftSection={<IconCar size={17} />} clearable searchable
          placeholder={carData.length ? 'escolha o perfil do carro' : 'nenhum perfil (crie em Carro)'}
          data={carData} value={value.carId} disabled={disabled} onChange={v => onChange({ carId: v })}
          nothingFoundMessage="Nenhum carro com esse nome" />
        <TagsInput label="Etiquetas" size="md" leftSection={<IconTag size={17} />} placeholder="ex.: enduro, setup A, chuva (Enter separa)"
          data={tags} value={value.tags} disabled={disabled} onChange={v => onChange({ tags: v })} clearable />
      </SimpleGrid>
      {withNotes && (
        <Textarea label="Notas" size="md" mt="sm" autosize minRows={2} maxRows={8} disabled={disabled}
          placeholder="o que foi testado, condições da pista, problemas…"
          value={value.notes} onChange={e => onChange({ notes: e.currentTarget.value })} />
      )}
    </>
  );
}
