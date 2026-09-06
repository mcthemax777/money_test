import { Plus } from 'lucide-react-native';
import { Pressable, Text } from 'react-native';

/**
 * 목록 위에 놓는 "추가하기" 버튼. 웹의 같은 이름 컴포넌트와 같은 모양이다.
 *
 * 점선 테두리와 흐린 글자다. 목록의 항목처럼 보이되 그 항목들과 다투지 않아야 해서
 * 채우지 않는다. 자리는 언제나 **그 목록 바로 위**다 -- 무엇에 더하는지가 버튼 아래에
 * 곧바로 이어져 보이고, 목록이 길어져도 버튼을 찾아 내려갈 일이 없다.
 */
export default function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="mb-3 flex-row items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 active:bg-gray-50"
    >
      <Plus size={16} color="#6b7280" />
      <Text className="text-sm text-gray-500">{label}</Text>
    </Pressable>
  );
}
