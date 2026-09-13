import {Tabs} from 'expo-router';
import {Pressable, StyleSheet, Text} from 'react-native';
import {useAuthStore} from '../../store/auth';

function LogoutButton() {
  return (
    <Pressable
      onPress={() => void useAuthStore.getState().logout()}
      hitSlop={8}
      style={styles.logout}
    >
      <Text style={styles.logoutText}>退出</Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{title: '我的团队', headerRight: () => <LogoutButton />}}
      />
      <Tabs.Screen name="search" options={{title: '搜索'}} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  logout: {marginRight: 16},
  logoutText: {color: '#d73a49', fontSize: 15}
});
