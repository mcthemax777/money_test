/*
 * 거래내역 엑셀 가져오기·내보내기. 웹의 settings/sheet 와 같은 짝이다.
 *
 * 파일 ↔ 행은 core 의 `entry-sheet`, 서버와 오가는 일은 `useEntrySheet` 가 한다. 이 화면은
 * 파일을 **얻고 내놓는** 자리다 -- 가져오기는 문서 고르기(expo-document-picker)로 고른 파일을
 * base64 로 읽고, 내보내기는 캐시에 파일을 써서 공유 창(expo-sharing)으로 넘긴다. 공유 창에서
 * 드라이브·메일·파일 앱 가운데 어디에 둘지 사람이 고른다.
 */
import { useState } from 'react';
import { LayoutAnimation, Pressable, ScrollView, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ENTRY_SHEET_COLUMNS, type EntrySheetDto } from '@money/types';

import { useEntrySheet } from '@money/core/hooks/useEntrySheet';
import {
  countEntrySheetEntries,
  entrySheetFileName,
  readEntrySheet,
  writeEntrySheet,
  type EntrySheetReadResult,
} from '@money/core/lib/entry-sheet';
import { useTranslation } from '@money/core/lib/i18n';
import { useCanEdit, useProject } from '@money/core/store/project';

import DatePickerPanel from '../components/DatePickerPanel';
import PageHeader from '../components/PageHeader';

const LABEL = new Map(ENTRY_SHEET_COLUMNS.map((column) => [column.key, column.label]));
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 펼치고 접는 움직임. 밀려나는 칸을 투명도로 잇는다. */
function animate() {
  LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
}

export default function EntrySheetScreen() {
  const { t } = useTranslation();
  const projectId = useProject((state) => state.selectedProjectId);
  const projectName = useProject(
    (state) => state.projects.find((project) => project.id === state.selectedProjectId)?.name ?? '',
  );
  const sheet = useEntrySheet(projectId);
  // 가져오기는 거래를 만든다. 조회자에게는 칸을 두지 않는다 (서버도 editor 만 받는다).
  const canEdit = useCanEdit();

  return (
    <View className="gap-6">
      <PageHeader title={t('sheet.title')} showBack />
      {sheet.error ? <Text className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{sheet.error}</Text> : null}
      <ExportSection sheet={sheet} projectName={projectName} />
      {canEdit ? <ImportSection sheet={sheet} /> : null}
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`items-center rounded-lg px-4 py-2.5 ${
        primary ? 'bg-blue-600 active:bg-blue-700' : 'border border-gray-300 bg-white active:bg-gray-50'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className={primary ? 'font-medium text-white' : 'text-gray-700'}>{label}</Text>
    </Pressable>
  );
}

function ExportSection({ sheet, projectName }: { sheet: ReturnType<typeof useEntrySheet>; projectName: string }) {
  const { t } = useTranslation();
  const [isRange, setIsRange] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [openDate, setOpenDate] = useState<'start' | 'end' | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const run = async () => {
    setDone(null);
    const rows = await sheet.exportRows(
      isRange ? { startDate: startDate || undefined, endDate: endDate || undefined } : {},
    );
    if (!rows) return;
    // 같은 이름이 남아 있으면 지우고 새로 쓴다(같은 날 두 번 내보낼 때).
    const file = new File(Paths.cache, entrySheetFileName(projectName));
    if (file.exists) file.delete();
    file.create();
    file.write(new Uint8Array(writeEntrySheet(rows, 'array')));
    await Sharing.shareAsync(file.uri, { mimeType: XLSX_MIME, dialogTitle: t('sheet.export.button') });
    setDone(rows.length);
  };

  return (
    <View className="gap-4 rounded-lg bg-white p-5 shadow-sm">
      <View className="gap-1">
        <Text className="text-lg font-semibold text-gray-900">{t('sheet.export.title')}</Text>
        <Text className="text-sm text-gray-600">{t('sheet.export.description')}</Text>
      </View>
      <View className="flex-row gap-2">
        {[false, true].map((value) => (
          <Pressable
            key={String(value)}
            onPress={() => {
              animate();
              setIsRange(value);
              setOpenDate(null);
            }}
            className={`rounded-lg px-3 py-1.5 ${isRange === value ? 'bg-blue-50' : ''}`}
          >
            <Text className={isRange === value ? 'font-medium text-blue-700' : 'text-gray-600'}>
              {t(value ? 'sheet.export.range' : 'sheet.export.all')}
            </Text>
          </Pressable>
        ))}
      </View>
      {isRange ? (
        <View className="gap-2">
          <View className="flex-row gap-2">
            {(['start', 'end'] as const).map((which) => {
              const value = which === 'start' ? startDate : endDate;
              return (
                <Pressable
                  key={which}
                  onPress={() => {
                    animate();
                    setOpenDate(openDate === which ? null : which);
                  }}
                  className={`flex-1 rounded-lg border px-3 py-2 ${openDate === which ? 'border-blue-400' : 'border-gray-300'}`}
                >
                  <Text className="text-xs text-gray-500">{t(which === 'start' ? 'sheet.export.start' : 'sheet.export.end')}</Text>
                  <Text className={value ? 'text-gray-900' : 'text-gray-400'}>{value || '—'}</Text>
                </Pressable>
              );
            })}
          </View>
          {openDate ? (
            <DatePickerPanel
              key={openDate}
              value={openDate === 'start' ? startDate : endDate}
              fallbackDate={openDate === 'start' ? endDate : startDate}
              onSelect={(dateKey) => {
                animate();
                if (openDate === 'start') setStartDate(dateKey);
                else setEndDate(dateKey);
                setOpenDate(null);
              }}
            />
          ) : null}
        </View>
      ) : null}
      <Button label={t('sheet.export.button')} onPress={() => void run()} disabled={sheet.isBusy} primary />
      {done !== null ? <Text className="text-sm text-green-700">{t('sheet.export.done', { count: done })}</Text> : null}
    </View>
  );
}

function ImportSection({ sheet }: { sheet: ReturnType<typeof useEntrySheet> }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<{ name: string; read: EntrySheetReadResult } | null>(null);
  const [readError, setReadError] = useState('');
  const [result, setResult] = useState<EntrySheetDto.ImportResponse | null>(null);

  const pick = async () => {
    setResult(null);
    setReadError('');
    const picked = await DocumentPicker.getDocumentAsync({
      type: [XLSX_MIME, 'application/vnd.ms-excel', 'text/csv', 'text/comma-separated-values'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    animate();
    try {
      setFile({ name: asset.name, read: readEntrySheet(await new File(asset.uri).base64()) });
    } catch {
      setFile(null);
      setReadError(t('sheet.import.readFailed'));
    }
  };

  const run = async () => {
    if (!file) return;
    const imported = await sheet.importRows(file.read.rows);
    if (imported) {
      animate();
      setResult(imported);
      setFile(null);
    }
  };

  const read = file?.read;
  const canImport = Boolean(read && read.missing.length === 0 && read.rows.length > 0 && !sheet.isBusy);
  const percent = sheet.progress ? Math.round((sheet.progress.done / Math.max(sheet.progress.total, 1)) * 100) : 0;

  return (
    <View className="gap-4 rounded-lg bg-white p-5 shadow-sm">
      <View className="gap-1">
        <Text className="text-lg font-semibold text-gray-900">{t('sheet.import.title')}</Text>
        <Text className="text-sm text-gray-600">{t('sheet.import.description')}</Text>
        <Text className="mt-1 text-xs text-gray-500">{t('sheet.import.guide')}</Text>
      </View>
      <Button label={t('sheet.import.pick')} onPress={() => void pick()} disabled={sheet.isBusy} />
      {readError ? <Text className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{readError}</Text> : null}

      {file && read ? (
        <View className="gap-2 rounded-lg bg-gray-50 p-4">
          <Text className="font-medium text-gray-900">
            {t('sheet.import.summary', { name: file.name, count: countEntrySheetEntries(read.rows), rows: read.rows.length })}
          </Text>
          <Text className="text-sm text-gray-600">
            {t('sheet.import.columns', { columns: read.columns.map((key) => LABEL.get(key)).join(', ') })}
          </Text>
          {read.ignoredHeaders.length ? (
            <Text className="text-sm text-gray-500">{t('sheet.import.ignored', { columns: read.ignoredHeaders.join(', ') })}</Text>
          ) : null}
          {read.missing.length ? (
            <Text className="text-sm text-red-700">{t('sheet.import.missing', { columns: read.missing.join(', ') })}</Text>
          ) : null}
          {read.rows.length === 0 ? <Text className="text-sm text-red-700">{t('sheet.import.empty')}</Text> : null}
          <Button label={t('sheet.import.button')} onPress={() => void run()} disabled={!canImport} primary />
        </View>
      ) : null}

      {sheet.progress && sheet.isBusy ? (
        <View className="gap-1">
          <View className="h-2 overflow-hidden rounded-full bg-gray-100">
            <View className="h-full rounded-full bg-blue-600" style={{ width: `${percent}%` }} />
          </View>
          <Text className="text-xs text-gray-500">
            {t('sheet.import.progress', { done: sheet.progress.done, total: sheet.progress.total })}
          </Text>
        </View>
      ) : null}

      {result ? <ImportResult result={result} /> : null}
    </View>
  );
}

function ImportResult({ result }: { result: EntrySheetDto.ImportResponse }) {
  const { t } = useTranslation();
  const names = result.createdNames;
  const groups = (
    [
      ['sheet.import.people', names.people],
      ['sheet.import.accounts', names.accounts],
      ['sheet.import.cards', names.cards],
      ['sheet.import.categories', names.categories],
      ['sheet.import.tags', names.tags],
    ] as const
  ).filter(([, list]) => list.length > 0);

  return (
    <View className="gap-3 rounded-lg border border-gray-200 p-4">
      <Text className="font-medium text-green-700">{t('sheet.import.created', { count: result.created })}</Text>
      {groups.length ? (
        <View className="gap-1">
          <Text className="font-medium text-gray-900">{t('sheet.import.createdNames')}</Text>
          {groups.map(([key, list]) => (
            <Text key={key} className="text-sm text-gray-700">
              <Text className="text-gray-500">{t(key)}: </Text>
              {list.join(', ')}
            </Text>
          ))}
          {names.cards.length ? <Text className="text-xs text-amber-700">{t('sheet.import.cardNote')}</Text> : null}
        </View>
      ) : null}
      {result.skipped.length ? (
        <View className="gap-1">
          <Text className="font-medium text-red-700">{t('sheet.import.skipped', { count: result.skipped.length })}</Text>
          <ScrollView className="max-h-64" nestedScrollEnabled>
            {result.skipped.map((item) => (
              <Text key={item.rows.join(',')} className="text-sm text-gray-700">
                <Text className="text-gray-500">{t('sheet.import.row', { rows: item.rows.join(', ') })} </Text>
                {item.reason}
              </Text>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
