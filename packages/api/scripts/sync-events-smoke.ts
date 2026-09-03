/**
 * 실시간 신호가 인스턴스 사이로 건너가는지 본다. 데이터베이스에 닿지 않는다.
 *
 * 실행 (레디스 없이):  cd packages/api && npx ts-node --transpile-only scripts/sync-events-smoke.ts
 * 실행 (레디스까지):   docker compose up -d redis 뒤에 REDIS_URL=redis://localhost:6379 를 앞에 붙인다.
 *
 * 눈으로 읽어서는 맞는지 알 수 없는 것이 셋이다.
 *
 *   1. **인스턴스 하나.** REDIS_URL 이 없으면 프로세스 안에서 흘러야 한다. 인스턴스를
 *      늘리기 전의 배포가 이 길로 돈다.
 *   2. **인스턴스 여럿.** 서비스를 둘 만들어 서로 다른 프로세스를 흉내 낸다. A 에 들어온
 *      쓰기가 B 에 붙어 있는 화면까지 닿아야 한다. **이것이 레디스를 두는 이유 전부다.**
 *   3. **레디스가 죽었을 때.** 신호를 보내지 못해도 쓰기가 실패하면 안 되고, 적어도
 *      자기 인스턴스의 화면은 따라붙어야 한다.
 */
import { SyncEventsService, type SyncEvent } from '@/modules/realtime/sync-events.service';

let fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
}

/** ConfigService 대역. 이 검사가 보는 것은 redisUrl 하나뿐이다. */
const configWith = (redisUrl: string | null) => ({ redisUrl }) as never;

/** 신호 하나를 기다린다. 오지 않으면 null 로 끝나 검사가 멈추지 않는다. */
function nextEvent(
  service: SyncEventsService,
  projectId: string,
  timeoutMs = 3_000,
): Promise<SyncEvent | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      subscription.unsubscribe();
      resolve(null);
    }, timeoutMs);

    const subscription = service.watch(projectId).subscribe((event) => {
      clearTimeout(timer);
      subscription.unsubscribe();
      resolve(event);
    });
  });
}

/** 연결이 준비될 때까지 기다린다. 붙기 전에 보내면 로컬로 새어 검사가 뜻을 잃는다. */
async function waitForRedis(service: SyncEventsService, timeoutMs = 5_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (service.isRedisConnected) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function main() {
  // ── 1. 인스턴스 하나. 레디스 없이 프로세스 안에서 흐른다 ──
  const solo = new SyncEventsService(configWith(null));
  solo.onModuleInit();

  const soloHeard = nextEvent(solo, 'project-1');
  solo.publish('project-1', 42);
  eq('레디스 없이도 신호가 흐른다', (await soloHeard)?.version, 42);

  // 다른 프로젝트의 신호는 새지 않는다. 한 채널을 함께 쓰기 때문에 이 거르기가 필요하다.
  const otherProject = nextEvent(solo, 'project-2', 500);
  solo.publish('project-1', 43);
  eq('다른 프로젝트의 화면은 받지 않는다', await otherProject, null);
  await solo.onModuleDestroy();

  // ── 2. 레디스가 죽어 있어도 쓰기 경로가 살아 있다 ──
  //
  // 없는 포트를 준다. publish 는 던지지 않아야 하고(쓰기가 실패하면 안 된다),
  // 자기 인스턴스의 화면은 그대로 따라붙어야 한다.
  const orphan = new SyncEventsService(configWith('redis://127.0.0.1:6399'));
  orphan.onModuleInit();
  const orphanHeard = nextEvent(orphan, 'project-1');
  orphan.publish('project-1', 7);
  eq('레디스가 죽어도 자기 화면은 따라붙는다', (await orphanHeard)?.version, 7);
  await orphan.onModuleDestroy();

  // ── 3. 인스턴스 여럿. A 의 쓰기가 B 의 화면에 닿는다 ──
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) {
    console.log('\nREDIS_URL 이 없어 인스턴스 사이 검사는 건너뜁니다.');
    console.log('돌리려면: docker compose up -d redis && REDIS_URL=redis://localhost:6379 ...');
    return;
  }

  const instanceA = new SyncEventsService(configWith(redisUrl));
  const instanceB = new SyncEventsService(configWith(redisUrl));
  instanceA.onModuleInit();
  instanceB.onModuleInit();

  const ready = (await waitForRedis(instanceA)) && (await waitForRedis(instanceB));
  eq('두 인스턴스가 레디스에 붙는다', ready, true);
  // 구독이 실제로 걸릴 틈을 준다. ready 는 연결이지 구독이 아니다.
  await new Promise((resolve) => setTimeout(resolve, 300));

  /*
   * 둘 다 먼저 구독해 두고 한 번만 보낸다.
   *
   * 보낸 뒤에 구독하면 레디스를 다녀오는 사이에 신호가 지나가 버려, 검사가 그다음
   * 신호를 기다리다 앞의 것을 받는다(실제로 그렇게 어긋났다). 보낸 인스턴스도 자기
   * 신호를 구독으로 되돌려 받는다는 것이 여기서 확인할 성질이다 -- 경로가 하나여야
   * 같은 신호가 두 번 도착하지 않는다.
   */
  const heardOnB = nextEvent(instanceB, 'project-9');
  const heardOnA = nextEvent(instanceA, 'project-9');
  instanceA.publish('project-9', 101);
  eq('A 의 쓰기가 B 의 화면에 닿는다', (await heardOnB)?.version, 101);
  eq('보낸 인스턴스도 같은 길로 받는다', (await heardOnA)?.version, 101);

  const filtered = nextEvent(instanceB, 'project-8', 500);
  instanceA.publish('project-9', 103);
  eq('레디스를 거쳐도 프로젝트로 거른다', await filtered, null);

  await instanceA.onModuleDestroy();
  await instanceB.onModuleDestroy();
}

main()
  .catch((error) => {
    console.error('실행 중 오류', error);
    fail += 1;
  })
  .finally(() => {
    console.log(fail === 0 ? '\n전체 통과' : `\n실패 ${fail}건`);
    process.exit(fail === 0 ? 0 : 1);
  });
