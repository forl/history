import warning from 'tiny-warning';
import invariant from 'tiny-invariant';

import { createLocation } from './LocationUtils';
import {
  addLeadingSlash,
  stripTrailingSlash,
  hasBasename,
  stripBasename,
  createPath
} from './PathUtils';
import createTransitionManager from './createTransitionManager';
import {
  canUseDOM,
  getConfirmation,
  supportsHistory,
  supportsPopStateOnHashChange,
  isExtraneousPopstateEvent
} from './DOMUtils';

const PopStateEvent = 'popstate';
const HashChangeEvent = 'hashchange';

function getHistoryState() {
  try {
    return window.history.state || {};
  } catch (e) {
    // IE 11 sometimes throws when accessing window.history.state
    // See https://github.com/ReactTraining/history/pull/289
    return {};
  }
}

/**
 * Creates a history object that uses the HTML5 history API including
 * pushState, replaceState, and the popstate event.
 */
function createBrowserHistory(props = {}) {
  invariant(canUseDOM, 'Browser history needs a DOM');

  const globalHistory = window.history;
  const canUseHistory = supportsHistory();
  const needsHashChangeListener = !supportsPopStateOnHashChange();

  const {
    forceRefresh = false,
    getUserConfirmation = getConfirmation,
    keyLength = 6
  } = props;
  const basename = props.basename
    ? stripTrailingSlash(addLeadingSlash(props.basename))
    : '';


  /**
   * 生成 location 对象，
   * 其中的 state 和 key 属性从 historyState 中得到
   * pathname、search、hash 属性从 window.location 中得到
   */
  function getDOMLocation(historyState) {
    // 这里的 historyState 即 window.history.state 或者 popstate 事件中的 state 属性
    // 但是我们约定了该 historyState 对象的结构为 {key, state}
    const { key, state } = historyState || {};
    const { pathname, search, hash } = window.location;

    let path = pathname + search + hash;

    warning(
      !basename || hasBasename(path, basename),
      'You are attempting to use a basename on a page whose URL path does not begin ' +
        'with the basename. Expected path "' +
        path +
        '" to begin with "' +
        basename +
        '".'
    );

    if (basename) path = stripBasename(path, basename);

    return createLocation(path, state, key);
  }

  function createKey() {
    return Math.random()
      .toString(36)
      .substr(2, keyLength);
  }

  const transitionManager = createTransitionManager();

  function setState(nextState) {
    // 如果是 revertPop 触发的 调用，nextState 为 undefined，
    // 即传入 notifyListeners 的 history.location 不变
    Object.assign(history, nextState);
    history.length = globalHistory.length;
    transitionManager.notifyListeners(history.location, history.action);
  }

  function handlePopState(event) {
    // Ignore extraneous popstate events in WebKit.
    if (isExtraneousPopstateEvent(event)) return;
    handlePop(getDOMLocation(event.state));
  }

  function handleHashChange() {
    handlePop(getDOMLocation(getHistoryState()));
  }

  let forceNextPop = false;

  /**
   * 只有点击“前进”、“后退”按钮，调用 go、goBack、goForward 才会触发此函数
   * 需要注意的是，此函数是在浏览器的 history 记录已经改变之后才被触发的
   * @param {*} location，目标 lacation，其内容来源于已经变化之后的浏览器的 history 记录
   */
  function handlePop(location) {
    if (forceNextPop) {
      // 调用 revertPop 触发的 handlePop 会进入这个分支
      // ?? 但是调用 setState 会触发用户注册的监听器，这合适吗？
      forceNextPop = false;
      setState();
    } else {
      const action = 'POP';

      transitionManager.confirmTransitionTo(
        location,
        action,
        getUserConfirmation,
        ok => {
          // 如果 getUserConfirmation 返回 true，ok 为 true
          if (ok) {
            setState({ action, location });
          } else {
            /**
             * 由于本函数只被 handlePopState 和 handlePopState 调用，而这两个函数分别是 popstate 和
             * hashchange 事件的监听器，当监听器被调用时，window.history 和 hash 状态已经发生变化，所以
             * getUserConfirmation 返回 false，则需要把 window.history 和 hash 发生的变化撤销回去，
             * revertPop 就是执行撤销的
             */
            revertPop(location);
          }
        }
      );
    }
  }

  /**
   * 根据 fromLocation 和当前 location 的 key 属性，再结合 allKeys 中维护的 key 顺序，确定回退的 delta 值
   * @param {*} fromLocation 
   */
  function revertPop(fromLocation) {
    const toLocation = history.location;

    // TODO: We could probably make this more reliable by
    // keeping a list of keys we've seen in sessionStorage.
    // Instead, we just default to 0 for keys we don't know.

    let toIndex = allKeys.indexOf(toLocation.key);

    if (toIndex === -1) toIndex = 0;

    let fromIndex = allKeys.indexOf(fromLocation.key);

    if (fromIndex === -1) fromIndex = 0;

    const delta = toIndex - fromIndex;

    if (delta) {
      // revert 操作
      forceNextPop = true;
      go(delta);
    }
  }

  const initialLocation = getDOMLocation(getHistoryState());

  /**
   * 为每一条 history 记录都设置了一个随机的唯一标识
   * 被这些唯一标示放在 allKeys 数组中的目的是维护 history 记录的顺序
   */
  let allKeys = [initialLocation.key];

  // Public interface

  function createHref(location) {
    return basename + createPath(location);
  }

  function push(path, state) {
    warning(
      !(
        typeof path === 'object' &&
        path.state !== undefined &&
        state !== undefined
      ),
      'You should avoid providing a 2nd state argument to push when the 1st ' +
        'argument is a location-like object that already has state; it is ignored'
    );

    const action = 'PUSH';
    const location = createLocation(path, state, createKey(), history.location);

    transitionManager.confirmTransitionTo(
      location,
      action,
      getUserConfirmation,
      ok => {
        // getUserConfirmation 返回 true 时 ok 为 true
        if (!ok) return;

        const href = createHref(location);
        const { key, state } = location;

        if (canUseHistory) {
          globalHistory.pushState({ key, state }, null, href);

          if (forceRefresh) {
            window.location.href = href;
          } else {
            /**
             *              current key
             *                 ↓
             * [..., 'keyX', 'keyY', 'keyZ', ...]
             * 因为是 push 操作，所以要把当前 key 后面的所有 key 删掉，然后在尾部追加 push 的新 key
             * 如果当前的 key 在 allKeys 中不存在，则清空 allKeys，再追加新 key
             */
            const prevIndex = allKeys.indexOf(history.location.key);
            const nextKeys = allKeys.slice(
              0,
              prevIndex === -1 ? 0 : prevIndex + 1
            );

            nextKeys.push(location.key);
            allKeys = nextKeys;

            setState({ action, location });
          }
        } else {
          warning(
            state === undefined,
            'Browser history cannot push state in browsers that do not support HTML5 history'
          );

          window.location.href = href;
        }
      }
    );
  }

  function replace(path, state) {
    warning(
      !(
        typeof path === 'object' &&
        path.state !== undefined &&
        state !== undefined
      ),
      'You should avoid providing a 2nd state argument to replace when the 1st ' +
        'argument is a location-like object that already has state; it is ignored'
    );

    const action = 'REPLACE';
    const location = createLocation(path, state, createKey(), history.location);

    transitionManager.confirmTransitionTo(
      location,
      action,
      getUserConfirmation,
      ok => {
        if (!ok) return;

        const href = createHref(location);
        const { key, state } = location;

        if (canUseHistory) {
          globalHistory.replaceState({ key, state }, null, href);

          if (forceRefresh) {
            window.location.replace(href);
          } else {
            const prevIndex = allKeys.indexOf(history.location.key);

            if (prevIndex !== -1) allKeys[prevIndex] = location.key;

            setState({ action, location });
          }
        } else {
          warning(
            state === undefined,
            'Browser history cannot replace state in browsers that do not support HTML5 history'
          );

          window.location.replace(href);
        }
      }
    );
  }

  // 以下的 go、goBack、goForward 只是对 HTML5 history API 的简单封装，并不会触发监听函数
  function go(n) {
    globalHistory.go(n);
  }

  function goBack() {
    go(-1);
  }

  function goForward() {
    go(1);
  }

  let listenerCount = 0;

  function checkDOMListeners(delta) {
    listenerCount += delta;

    // ?? 这里的做法如果用户多次调用同一个 unlisten 还能保证正确吗？
    // 这个问题在官方 repo 中有 issue 讨论了这个问题，并且有 PR 尝试修复这个问题
    // 但最终都不了了之。可以确定的是，如果调用两次 unlisten 确实可能会导致问题
    // https://github.com/ReactTraining/history/pull/436
    // https://github.com/ReactTraining/history/pull/440
    if (listenerCount === 1 && delta === 1) {
      window.addEventListener(PopStateEvent, handlePopState);

      if (needsHashChangeListener)
        // 用户点击锚点引起 hash 变化会产生 hashchange 事件
        window.addEventListener(HashChangeEvent, handleHashChange);
    } else if (listenerCount === 0) {
      window.removeEventListener(PopStateEvent, handlePopState);

      if (needsHashChangeListener)
        window.removeEventListener(HashChangeEvent, handleHashChange);
    }
  }

  let isBlocked = false;

  function block(prompt = false) {
    const unblock = transitionManager.setPrompt(prompt);

    if (!isBlocked) {
      checkDOMListeners(1);
      isBlocked = true;
    }

    return () => {
      if (isBlocked) {
        isBlocked = false;
        checkDOMListeners(-1);
      }

      return unblock();
    };
  }

  function listen(listener) {
    const unlisten = transitionManager.appendListener(listener);
    checkDOMListeners(1);

    // 以下反回的 unlisten 如果被调用多次会如何？
    return () => {
      checkDOMListeners(-1);
      unlisten();
    };
  }

  const history = {
    length: globalHistory.length,
    action: 'POP',
    location: initialLocation,
    createHref,
    push,
    replace,
    go,
    goBack,
    goForward,
    block,
    listen
  };

  return history;
}

export default createBrowserHistory;
