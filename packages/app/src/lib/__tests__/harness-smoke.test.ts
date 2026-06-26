describe('app jest harness', () => {
  it('runs TypeScript logic tests in a node environment', () => {
    const doubled = [1, 2, 3].map((n) => n * 2);
    expect(doubled).toEqual([2, 4, 6]);
  });
});
