import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';

import App from './App';
import { INBOX_COLLECT_TASK, inboxCollectTask } from './src/inbox-task';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

// 알림이 오면 네이티브가 깨우는 작업. 화면이 없어도 돈다 (src/inbox-task.ts).
AppRegistry.registerHeadlessTask(INBOX_COLLECT_TASK, () => inboxCollectTask);
