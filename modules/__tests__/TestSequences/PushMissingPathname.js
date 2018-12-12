import expect from 'expect';

import execSteps from './execSteps';

export default function(history, done) {
  const steps = [
    // 如果添加以下测试步骤，就会触发多次调用 unlisten 的潜在问题
    // () => {
    //   const unlisten = history.listen(()=>{});
    //   unlisten();
    //   unlisten();
    // },
    location => {
      expect(location).toMatchObject({
        pathname: '/'
      });

      history.push('/home?the=query#the-hash');
    },
    (location, action) => {
      expect(action).toBe('PUSH');
      expect(location).toMatchObject({
        pathname: '/home',
        search: '?the=query',
        hash: '#the-hash'
      });

      history.push('?another=query#another-hash');
    },
    (location, action) => {
      expect(action).toBe('PUSH');
      expect(location).toMatchObject({
        pathname: '/home',
        search: '?another=query',
        hash: '#another-hash'
      });
    }
  ];

  execSteps(steps, history, done);
}
