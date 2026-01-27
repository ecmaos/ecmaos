#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <dirent.h>
#include <time.h>
#include <errno.h>
#include <stdint.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

extern double emscripten_date_now(void);
extern size_t emscripten_get_heap_max(void);
extern int emscripten_resize_heap(size_t requestedSize);

void test_args(int argc, char *argv[]) {
  printf("=== Testing Command Line Arguments ===\n");
  printf("argc = %d\n", argc);
  
  for (int i = 0; i < argc; i++) {
    if (argv[i]) {
      printf("argv[%d] = '%s'\n", i, argv[i]);
    } else {
      printf("argv[%d] = (null)\n", i);
    }
  }
  printf("\n");
}

void test_stdin() {
  printf("=== Testing Stdin ===\n");
  printf("Reading stdin (enter text, Ctrl+D to end):\n");
  
  char buffer[256];
  int line_num = 0;
  
  while (fgets(buffer, sizeof(buffer), stdin) != NULL) {
    line_num++;
    size_t len = strlen(buffer);
    if (len > 0 && buffer[len-1] == '\n') {
      buffer[len-1] = '\0';
    }
    printf("Line %d: '%s'\n", line_num, buffer);
  }
  
  if (line_num == 0) {
    printf("No input received.\n");
  } else {
    printf("Read %d line(s).\n", line_num);
  }
  printf("\n");
}

void test_stdout_stderr() {
  printf("=== Testing Stdout/Stderr ===\n");
  printf("This is stdout output.\n");
  fprintf(stderr, "This is stderr output.\n");
  printf("\n");
}

void test_file_operations() {
  printf("=== Testing File Operations ===\n");
  
  const char *test_file = "/tmp/test_file.txt";
  const char *test_content = "Hello, World!\nThis is a test file.\n";
  const char *append_content = "Appended content.\n";
  
  FILE *fp = fopen(test_file, "w");
  if (fp) {
    printf("✓ Created file: %s\n", test_file);
    size_t written = fwrite(test_content, 1, strlen(test_content), fp);
    printf("✓ Wrote %zu bytes\n", written);
    fclose(fp);
  } else {
    printf("✗ Failed to create file: %s (errno: %d)\n", test_file, errno);
  }
  
  fp = fopen(test_file, "r");
  if (fp) {
    printf("✓ Opened file for reading: %s\n", test_file);
    char read_buffer[256];
    size_t read = fread(read_buffer, 1, sizeof(read_buffer) - 1, fp);
    read_buffer[read] = '\0';
    printf("✓ Read %zu bytes: %s", read, read_buffer);
    fclose(fp);
  } else {
    printf("✗ Failed to open file for reading: %s (errno: %d)\n", test_file, errno);
  }
  
  fp = fopen(test_file, "a");
  if (fp) {
    printf("✓ Opened file for appending: %s\n", test_file);
    fwrite(append_content, 1, strlen(append_content), fp);
    printf("✓ Appended content\n");
    fclose(fp);
  }
  
  struct stat st;
  if (stat(test_file, &st) == 0) {
    printf("✓ stat() successful\n");
    printf("  Size: %ld bytes\n", (long)st.st_size);
    printf("  Mode: %o\n", st.st_mode & 0777);
    printf("  Inode: %lu\n", (unsigned long)st.st_ino);
  } else {
    printf("✗ stat() failed (errno: %d)\n", errno);
  }
  
  if (lstat(test_file, &st) == 0) {
    printf("✓ lstat() successful\n");
  } else {
    printf("✗ lstat() failed (errno: %d)\n", errno);
  }
  
  printf("\n");
}

void test_file_descriptors() {
  printf("=== Testing File Descriptors ===\n");
  
  const char *test_file = "/tmp/test_fd.txt";
  const char *content = "File descriptor test\n";
  
  int fd = open(test_file, O_CREAT | O_WRONLY | O_TRUNC, 0644);
  if (fd >= 0) {
    printf("✓ open() successful, fd = %d\n", fd);
    ssize_t written = write(fd, content, strlen(content));
    printf("✓ write() wrote %zd bytes\n", written);
    close(fd);
    printf("✓ close() successful\n");
  } else {
    printf("✗ open() failed (errno: %d)\n", errno);
  }
  
  fd = open(test_file, O_RDONLY);
  if (fd >= 0) {
    printf("✓ open() for reading, fd = %d\n", fd);
    char buffer[256];
    ssize_t read_bytes = read(fd, buffer, sizeof(buffer) - 1);
    if (read_bytes >= 0) {
      buffer[read_bytes] = '\0';
      printf("✓ read() read %zd bytes: %s", read_bytes, buffer);
    } else {
      printf("✗ read() failed (errno: %d)\n", errno);
    }
    close(fd);
  } else {
    printf("✗ open() for reading failed (errno: %d)\n", errno);
  }
  
  printf("\n");
}

void test_directory_operations() {
  printf("=== Testing Directory Operations ===\n");
  
  const char *test_dir = "/tmp/test_dir";
  const char *test_subdir = "/tmp/test_dir/subdir";
  
  if (mkdir(test_dir, 0755) == 0) {
    printf("✓ mkdir() created: %s\n", test_dir);
  } else {
    if (errno == EEXIST) {
      printf("✓ Directory already exists: %s\n", test_dir);
    } else {
      printf("✗ mkdir() failed: %s (errno: %d)\n", test_dir, errno);
    }
  }
  
  if (mkdir(test_subdir, 0755) == 0) {
    printf("✓ mkdir() created: %s\n", test_subdir);
  } else {
    if (errno == EEXIST) {
      printf("✓ Subdirectory already exists: %s\n", test_subdir);
    } else {
      printf("✗ mkdir() failed: %s (errno: %d)\n", test_subdir, errno);
    }
  }
  
  DIR *dir = opendir(test_dir);
  if (dir) {
    printf("✓ opendir() successful: %s\n", test_dir);
    struct dirent *entry;
    int count = 0;
    while ((entry = readdir(dir)) != NULL) {
      count++;
      printf("  Entry %d: %s (type: %d)\n", count, entry->d_name, entry->d_type);
    }
    printf("✓ readdir() found %d entries\n", count);
    closedir(dir);
    printf("✓ closedir() successful\n");
  } else {
    printf("✗ opendir() failed (errno: %d)\n", errno);
  }
  
  printf("\n");
}

void test_path_operations() {
  printf("=== Testing Path Operations ===\n");
  
  const char *old_file = "/tmp/old_file.txt";
  const char *new_file = "/tmp/new_file.txt";
  const char *content = "Rename test\n";
  
  FILE *fp = fopen(old_file, "w");
  if (fp) {
    fwrite(content, 1, strlen(content), fp);
    fclose(fp);
    printf("✓ Created file: %s\n", old_file);
  }
  
  if (rename(old_file, new_file) == 0) {
    printf("✓ rename() successful: %s -> %s\n", old_file, new_file);
  } else {
    printf("✗ rename() failed (errno: %d)\n", errno);
  }
  
  if (access(new_file, F_OK) == 0) {
    printf("✓ access() found file: %s\n", new_file);
  } else {
    printf("✗ access() failed (errno: %d)\n", errno);
  }
  
  if (unlink(new_file) == 0) {
    printf("✓ unlink() successful: %s\n", new_file);
  } else {
    printf("✗ unlink() failed (errno: %d)\n", errno);
  }
  
  printf("\n");
}

void test_process_info() {
  printf("=== Testing Process Info ===\n");
  
  pid_t pid = getpid();
  printf("✓ getpid() = %d\n", pid);
  
  uid_t uid = getuid();
  printf("✓ getuid() = %u\n", uid);
  
  gid_t gid = getgid();
  printf("✓ getgid() = %u\n", gid);
  
  uid_t euid = geteuid();
  printf("✓ geteuid() = %u\n", euid);
  
  gid_t egid = getegid();
  printf("✓ getegid() = %u\n", egid);
  
  char cwd[256];
  if (getcwd(cwd, sizeof(cwd)) != NULL) {
    printf("✓ getcwd() = '%s'\n", cwd);
  } else {
    printf("✗ getcwd() failed (errno: %d)\n", errno);
  }
  
  printf("\n");
}

void test_time_operations() {
  printf("=== Testing Time Operations ===\n");
  
  time_t now = time(NULL);
  printf("✓ time() = %ld\n", (long)now);
  
  struct tm *local_tm = localtime(&now);
  if (local_tm) {
    printf("✓ localtime() successful\n");
    printf("  Year: %d, Month: %d, Day: %d\n", 
           local_tm->tm_year + 1900, local_tm->tm_mon + 1, local_tm->tm_mday);
    printf("  Hour: %d, Minute: %d, Second: %d\n",
           local_tm->tm_hour, local_tm->tm_min, local_tm->tm_sec);
  } else {
    printf("✗ localtime() failed\n");
  }
  
  struct tm *utc_tm = gmtime(&now);
  if (utc_tm) {
    printf("✓ gmtime() successful\n");
  } else {
    printf("✗ gmtime() failed\n");
  }
  
  time_t mktime_result = mktime(local_tm);
  if (mktime_result != -1) {
    printf("✓ mktime() = %ld\n", (long)mktime_result);
  } else {
    printf("✗ mktime() failed\n");
  }
  
  printf("\n");
}

void test_random() {
  printf("=== Testing Random Number Generation ===\n");
  
  FILE *urandom = fopen("/dev/urandom", "r");
  if (urandom) {
    uint32_t random_value;
    if (fread(&random_value, sizeof(random_value), 1, urandom) == 1) {
      printf("✓ Read random value: 0x%08x\n", random_value);
    }
    fclose(urandom);
  } else {
    printf("✗ Failed to open /dev/urandom (errno: %d)\n", errno);
  }
  
  printf("\n");
}

void test_emscripten_functions() {
  printf("=== Testing Emscripten/Custom Runtime Functions ===\n");
  
#ifdef __EMSCRIPTEN__
  double now = emscripten_get_now();
  printf("✓ emscripten_get_now() = %.2f ms\n", now);
#else
  printf("ℹ emscripten_get_now() not available (not compiled with Emscripten)\n");
#endif
  
  double date_now = emscripten_date_now();
  printf("✓ emscripten_date_now() = %.2f ms\n", date_now);
  
  size_t heap_max = emscripten_get_heap_max();
  printf("✓ emscripten_get_heap_max() = %zu bytes\n", heap_max);
  
  int resize_result = emscripten_resize_heap(1024 * 1024);
  printf("✓ emscripten_resize_heap() = %d\n", resize_result);
  
  printf("\n");
}

void test_environment() {
  printf("=== Testing Environment Variables ===\n");
  
  extern char **environ;
  int env_count = 0;
  if (environ) {
    for (int i = 0; environ[i] != NULL; i++) {
      env_count++;
    }
    printf("✓ Found %d environment variables\n", env_count);
    if (env_count > 0) {
      printf("  First few:\n");
      for (int i = 0; i < env_count && i < 3; i++) {
        printf("    %s\n", environ[i]);
      }
    }
  } else {
    printf("✗ environ is NULL\n");
  }
  
  const char *test_var = getenv("PATH");
  if (test_var) {
    printf("✓ getenv(\"PATH\") = '%s'\n", test_var);
  } else {
    printf("✗ getenv(\"PATH\") returned NULL\n");
  }
  
  printf("\n");
}

void test_file_permissions() {
  printf("=== Testing File Permissions ===\n");
  
  const char *test_file = "/tmp/perm_test.txt";
  FILE *fp = fopen(test_file, "w");
  if (fp) {
    fprintf(fp, "Permission test\n");
    fclose(fp);
    printf("✓ Created file: %s\n", test_file);
    
    if (chmod(test_file, 0644) == 0) {
      printf("✓ chmod() successful\n");
    } else {
      printf("✗ chmod() failed (errno: %d)\n", errno);
    }
    
    struct stat st;
    if (stat(test_file, &st) == 0) {
      printf("✓ File mode: %o\n", st.st_mode & 0777);
    }
    
    unlink(test_file);
  } else {
    printf("✗ Failed to create file: %s (errno: %d)\n", test_file, errno);
  }
  
  printf("\n");
}

void test_seek_operations() {
  printf("=== Testing Seek Operations ===\n");
  
  const char *test_file = "/tmp/seek_test.txt";
  const char *content = "0123456789ABCDEF";
  
  FILE *fp = fopen(test_file, "w");
  if (fp) {
    fwrite(content, 1, strlen(content), fp);
    fclose(fp);
    printf("✓ Created file: %s\n", test_file);
  }
  
  fp = fopen(test_file, "r");
  if (fp) {
    if (fseek(fp, 5, SEEK_SET) == 0) {
      printf("✓ fseek() to position 5\n");
      char buffer[10];
      if (fread(buffer, 1, 5, fp) == 5) {
        buffer[5] = '\0';
        printf("✓ Read from position 5: '%s'\n", buffer);
      }
    }
    
    long pos = ftell(fp);
    printf("✓ ftell() = %ld\n", pos);
    
    fclose(fp);
    unlink(test_file);
  }
  
  printf("\n");
}

int main(int argc, char *argv[]) {
  printf("========================================\n");
  printf("WASM Syscall Test Suite\n");
  printf("========================================\n\n");
  
  test_args(argc, argv);
  test_stdout_stderr();
  test_file_operations();
  test_file_descriptors();
  test_directory_operations();
  test_path_operations();
  test_process_info();
  test_time_operations();
  test_random();
  test_environment();
  test_file_permissions();
  test_seek_operations();
  
  test_emscripten_functions();
  
  printf("=== Testing Stdin (optional) ===\n");
  printf("You can provide stdin input now, or press Ctrl+D to skip:\n");
  test_stdin();
  
  printf("========================================\n");
  printf("All tests completed!\n");
  printf("========================================\n");
  
  return 0;
}
