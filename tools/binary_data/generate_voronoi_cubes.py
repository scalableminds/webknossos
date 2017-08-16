import np

d = 128
points = np.random.randint(0, d, (32, 3))
hull_space=np.zeros([d,d,d], dtype=np.int8)
for x in range(d):
    for y in range(d):
        for z in range(d):
            coord = np.array([x,y,z])
            diff = points - coord
            dist = diff[:,0]**2 + diff[:,1]**2 + diff[:,2]**2
            closest = np.argmin(dist)
            hull_space[x][y][z] = closest * 8
