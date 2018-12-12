export default function execSteps(steps, history, done) {
  let index = 0,
    unlisten,
    cleanedUp = false;

  const cleanup = (...args) => {
    if (!cleanedUp) {
      cleanedUp = true;
      unlisten();
      done(...args);
    }
  };

  const execNextStep = (...args) => {
    try {
      const nextStep = steps[index++];

      if (!nextStep) throw new Error('Test is missing step ' + index);

      nextStep(...args);

      if (index === steps.length) cleanup();
    } catch (error) {
      cleanup(error);
    }
  };

  if (steps.length) {
    // 通过监听器驱动 step，只要每一个 step 函数中有且仅有一个 navigation 操作，就能自动跑完所有 steps
    unlisten = history.listen(execNextStep);
    execNextStep(history.location);
  } else {
    done();
  }
}
