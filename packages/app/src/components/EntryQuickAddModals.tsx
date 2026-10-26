/*
 * 거래 입력의 고르는 칸에서 그 자리에 만드는 창들.
 *
 * 거래 입력(EntryEditor)에서 떼어 냈다 (2026-10-26). 어느 창이 열렸는지와 만드는 일은
 * useEntryQuickAdd 가 들고, 여기서는 창만 그린다.
 *
 * 구성원·통장·카드는 자산 화면이 쓰는 창을 그대로 쓴다. 같은 것을 만드는 자리가
 * 화면마다 다르게 생기면 사용자는 그 둘이 다른 것이라고 읽는다.
 */
import { Pressable, Text, View } from 'react-native';

import { useTranslation } from '@money/core/lib/i18n';
import type { useEntryForm } from '@money/core/hooks/useEntryForm';
import { accountValue, cardValue } from '@money/core/data/entry-form';

import { AddAccountModal, AddCardModal, AddPersonModal } from './AssetAddModals';
import Modal from './Modal';
import { AddCategoryModal, AddTagModal } from './QuickAddModals';
import type { EntryQuickAdd } from './useEntryQuickAdd';

export default function EntryQuickAddModals({
  quick,
  form,
}: {
  quick: EntryQuickAdd;
  form: ReturnType<typeof useEntryForm>;
}) {
  const { t } = useTranslation();
  const { values, setField } = form;
  const { quickAdd, adding, setAdding, addThenPick, newAccountOwner, newCardAccount } = quick;

  return (
    <>
      <AddPersonModal
        isOpen={adding === 'person'}
        onClose={() => setAdding(null)}
        isSubmitting={quickAdd.isSubmitting}
        onSubmit={(input) =>
          addThenPick(quickAdd.addPerson(input), (id) => setField('personId', id))
        }
      />

      {/* 결제수단은 통장과 카드를 한 목록에서 고르므로 무엇을 만들지 먼저 묻는다. */}
      <Modal
        isOpen={adding === 'method'}
        onClose={() => setAdding(null)}
        title={t('editor.addMethod')}
      >
        <View className="gap-3">
          <MethodChoice
            label={t('account.add')}
            description={t('account.addDescription')}
            disabled={!newAccountOwner}
            onPress={() => setAdding('account')}
          />
          <MethodChoice
            label={t('card.add')}
            description={t('card.addDescription')}
            disabled={!newCardAccount}
            onPress={() => setAdding('card')}
          />
          {/* 둘 다 잠겼으면 왜 그런지 적는다. 눌리지 않는 단추만 두면 고장으로 보인다. */}
          {!newAccountOwner ? (
            <Text className="text-sm text-gray-500">{t('editor.needPerson')}</Text>
          ) : !newCardAccount ? (
            <Text className="text-sm text-gray-500">{t('assets.noAccounts')}</Text>
          ) : null}
        </View>
      </Modal>

      {newAccountOwner ? (
        <AddAccountModal
          isOpen={adding === 'account'}
          onClose={() => setAdding(null)}
          isSubmitting={quickAdd.isSubmitting}
          /* 거래를 적다가 만드는 통장이다. 주인은 폼에서 고른 거래자로 채워 둔다. */
          people={form.lists.people}
          defaultOwnerId={newAccountOwner.id}
          onSubmit={(input) =>
            addThenPick(quickAdd.addAccount(input), (id) => setField('method', accountValue(id)))
          }
        />
      ) : null}

      {newCardAccount ? (
        <AddCardModal
          isOpen={adding === 'card'}
          onClose={() => setAdding(null)}
          isSubmitting={quickAdd.isSubmitting}
          /* 결제 통장은 거래에서 이미 정해졌다. 그 하나만 고른 채로 보여 준다. */
          accounts={[newCardAccount]}
          defaultAccountId={newCardAccount.id}
          onSubmit={(input) =>
            addThenPick(quickAdd.addCard(input), (id) => setField('method', cardValue(id)))
          }
        />
      ) : null}

      <AddCategoryModal
        isOpen={adding === 'category'}
        onClose={() => setAdding(null)}
        isSubmitting={quickAdd.isSubmitting}
        type={quick.categoryType}
        categories={form.categoryChoices}
        onSubmit={(input) =>
          addThenPick(quick.createCategory(input), (id) => {
            /*
              만든 분류를 그 자리에 꽂는다.

              이체의 수수료 칸은 분류를 따로 들고 있어 그쪽에서 열었으면 그쪽에 넣는다.
              분할 줄은 줄마다 분류가 달라 어느 줄에 넣을지 알 수 없으므로 두지 않는다 --
              목록에는 나타나므로 원하는 줄에서 누르면 된다.
            */
            if (values.kind === 'transfer') setField('transferFeeCategoryId', id);
            else if (values.splits.length === 0) setField('categoryId', id);
          })
        }
      />

      <AddTagModal
        isOpen={adding === 'tag'}
        onClose={() => setAdding(null)}
        isSubmitting={quickAdd.isSubmitting}
        onSubmit={(input) => addThenPick(quickAdd.addTag(input), form.toggleTag)}
      />
    </>
  );
}

/** 무엇을 만들지 고르는 줄. 통장과 카드 둘뿐이라 목록 대신 큰 단추 둘이다. */
function MethodChoice({
  label,
  description,
  disabled,
  onPress,
}: {
  label: string;
  description: string;
  /** 만들 바탕이 없을 때. 통장은 주인이, 카드는 결제 통장이 있어야 한다. */
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`rounded-lg border border-gray-200 px-4 py-3 active:bg-gray-50 ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      <Text className="text-base font-medium text-gray-900">{label}</Text>
      <Text className="mt-0.5 text-sm text-gray-500">{description}</Text>
    </Pressable>
  );
}
