<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BookOpen,
  CheckCircle2,
  Database,
  MessagesSquare,
  Moon,
  Network,
  Rabbit,
  RadioTower,
  Rocket,
  Sun,
} from '@lucide/vue'
import MvccLab from './components/MvccLab.vue'
import KafkaLab from './components/KafkaLab.vue'
import RabbitLab from './components/RabbitLab.vue'
import RedisClusterLab from './components/RedisClusterLab.vue'
import RedisSentinelLab from './components/RedisSentinelLab.vue'
import RocketMqLab from './components/RocketMqLab.vue'

type TopicId = 'mvcc' | 'redis-sentinel' | 'redis-cluster' | 'kafka' | 'rabbitmq' | 'rocketmq'

const topics = [
  {
    id: 'mvcc' as TopicId,
    group: '数据库原理',
    title: 'MySQL MVCC',
    subtitle: 'Read View 与版本链',
    icon: markRaw(Database),
    component: markRaw(MvccLab),
  },
  {
    id: 'redis-sentinel' as TopicId,
    group: '分布式系统',
    title: 'Redis Sentinel',
    subtitle: '选举与故障转移',
    icon: markRaw(RadioTower),
    component: markRaw(RedisSentinelLab),
  },
  {
    id: 'redis-cluster' as TopicId,
    group: '分布式系统',
    title: 'Redis Cluster',
    subtitle: '槽位路由与副本选举',
    icon: markRaw(Network),
    component: markRaw(RedisClusterLab),
  },
  {
    id: 'kafka' as TopicId,
    group: '消息中间件',
    title: 'Apache Kafka',
    subtitle: '生产、复制与消费组',
    icon: markRaw(MessagesSquare),
    component: markRaw(KafkaLab),
  },
  {
    id: 'rabbitmq' as TopicId,
    group: '消息中间件',
    title: 'RabbitMQ',
    subtitle: 'Confirm、Return 与 Ack',
    icon: markRaw(Rabbit),
    component: markRaw(RabbitLab),
  },
  {
    id: 'rocketmq' as TopicId,
    group: '消息中间件',
    title: 'Apache RocketMQ',
    subtitle: 'Half Message 与事务回查',
    icon: markRaw(Rocket),
    component: markRaw(RocketMqLab),
  },
]

function topicFromHash(): TopicId {
  const hashTopic = window.location.hash.replace('#', '') as TopicId
  return topics.some((topic) => topic.id === hashTopic) ? hashTopic : 'mvcc'
}

const activeTopic = ref<TopicId>(topicFromHash())
const theme = ref<'light' | 'dark'>('light')
const currentTopic = computed(() => topics.find((topic) => topic.id === activeTopic.value) ?? topics[0])

function selectTopic(id: TopicId) {
  activeTopic.value = id
  window.location.hash = id
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
}

function syncTopicFromHash() {
  activeTopic.value = topicFromHash()
}

watch(theme, (value) => {
  document.documentElement.dataset.theme = value
  localStorage.setItem('learn-view-theme', value)
})

onMounted(() => {
  const saved = localStorage.getItem('learn-view-theme')
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  theme.value = saved === 'dark' || (!saved && prefersDark) ? 'dark' : 'light'
  window.addEventListener('hashchange', syncTopicFromHash)
})

onBeforeUnmount(() => window.removeEventListener('hashchange', syncTopicFromHash))
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#mvcc" aria-label="原理实验室首页" @click.prevent="selectTopic('mvcc')">
        <span class="brand-mark"><BookOpen :size="20" /></span>
        <span><strong>原理实验室</strong><small>LEARN VIEW</small></span>
      </a>
      <div class="topbar-content">
        <div class="current-path">
          <span>{{ currentTopic.group }}</span>
          <span class="path-separator">/</span>
          <strong>{{ currentTopic.title }}</strong>
        </div>
        <div class="topbar-actions">
          <span class="ready-status"><span /> {{ topics.length }} 个实验可运行</span>
          <button
            type="button"
            class="icon-button theme-toggle"
            :aria-label="theme === 'light' ? '切换到深色主题' : '切换到浅色主题'"
            :data-tooltip="theme === 'light' ? '深色主题' : '浅色主题'"
            @click="toggleTheme"
          >
            <Moon v-if="theme === 'light'" :size="17" />
            <Sun v-else :size="17" />
          </button>
        </div>
      </div>
    </header>

    <div class="app-body">
      <aside class="sidebar">
        <nav aria-label="实验主题">
          <template v-for="group in ['数据库原理', '分布式系统', '消息中间件']" :key="group">
            <div class="nav-group-label">{{ group }}</div>
            <button
              v-for="topic in topics.filter((item) => item.group === group)"
              :key="topic.id"
              type="button"
              class="topic-button"
              :class="{ 'is-active': activeTopic === topic.id }"
              :aria-current="activeTopic === topic.id ? 'page' : undefined"
              @click="selectTopic(topic.id)"
            >
              <span class="topic-icon"><component :is="topic.icon" :size="18" /></span>
              <span class="topic-copy"><strong>{{ topic.title }}</strong><small>{{ topic.subtitle }}</small></span>
              <CheckCircle2 v-if="activeTopic === topic.id" class="topic-check" :size="15" />
            </button>
          </template>
        </nav>

        <div class="sidebar-footer">
          <Network :size="17" />
          <span><strong>事件驱动模拟</strong><small>状态与动画完全同步</small></span>
        </div>
      </aside>

      <main
        class="main-content"
        :class="{
          'main-content--mvcc': activeTopic === 'mvcc',
          'main-content--redis': ['redis-sentinel', 'redis-cluster', 'kafka', 'rabbitmq', 'rocketmq'].includes(activeTopic),
        }"
      >
        <Transition name="lab-switch" mode="out-in">
          <component :is="currentTopic.component" :key="currentTopic.id" />
        </Transition>
      </main>
    </div>
  </div>
</template>
